/**
 * Writes the seed scenarios of seedMonth.ts as JSON fixtures for the ERPNext app's report
 * tests, so the same month can be replayed there and checked against the same figures.
 *
 *   npm run seed:export
 *
 * No database: everything comes from the seed's own plan and its hand-worked figures.
 *
 * Two things the seed reads from the database are made up here instead, the same way every
 * time: the vendors and their papers (the seed books rolls on the first vendors with papers,
 * by vendor code), and the two locations (the first two active ones). Each roll keeps the
 * seed's own pick of vendor and paper by index, so the designs repeat across rolls exactly
 * as the seed's picks make them. Remark labels are the ones the seed's daily checks expect.
 *
 * Write order matters to the reports: `seq` is the order the seed writes things in (rolls
 * and movements together, stably sorted by when each was saved). A replay must give each
 * record a `creation` in that order, with no ties on the same roll.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BULK_LOTS,
  DAILY,
  EXPECTED,
  LOTS,
  MATERIALS,
  MOVEMENTS,
  OCTOBER_BY_ROLL,
  ROLLS,
  bulkPlan,
  computeBulkTally,
} from "./seedMonth";

const OUT_DIR = resolve(__dirname, "../../../erpnext/royal_touche/royal_touche/tests/fixtures");
const PREFIX = "SEED-";
const FIELDS = ["opening", "received", "consumed", "returned_to_vendor", "sold", "adjusted", "closing", "out_at_close"] as const;
type MaterialKey = keyof typeof MATERIALS;
type Figures = Record<(typeof FIELDS)[number], number>;
type RollPlan = (typeof ROLLS)[number];
type Movement = (typeof MOVEMENTS)[number];

/** Same as the seed's: an India-time moment, "MM-DD HH:mm" in 2026. */
const at = (when: string) => `2026-${when.replace(" ", "T")}:00+05:30`;

const figures = (values: number[]): Figures =>
  Object.fromEntries(FIELDS.map((field, i) => [field, values[i]])) as Figures;

const byMaterialCode = (values: Partial<Record<MaterialKey, number[]>>) =>
  Object.fromEntries(
    (Object.keys(values) as MaterialKey[]).map((key) => [MATERIALS[key], figures(values[key]!)]),
  );

// ---- Made-up masters ---------------------------------------------------------------------

const PAPERS_PER_VENDOR = 25;

/** Paper j of vendor v. RT codes are shared across vendors (the same design on file under
 *  several vendors); every fifth paper is Delta-only and every third RT-only. Odd vendors
 *  type their Delta codes in lower case, which the design report must not tell apart. */
function paper(v: number, j: number) {
  const deltaOnly = j % 5 === 4;
  const rtOnly = !deltaOnly && j % 3 === 2;
  const delta = `SD${700 + j}`;
  return {
    paper_code: `SV${v + 1}-P${j + 1}`,
    rt_code: deltaOnly ? "" : `SRT${600 + j}`,
    delta_code: rtOnly ? "" : v % 2 === 1 ? delta.toLowerCase() : delta,
  };
}

function vendors(count: number) {
  return Array.from({ length: count }, (_, v) => ({
    vendor_code: `${PREFIX}V${String(v + 1).padStart(2, "0")}`,
    name: `Seed Vendor ${v + 1}`,
    papers: Array.from({ length: PAPERS_PER_VENDOR }, (_, j) => paper(v, j)),
  }));
}

const LOCATIONS = [{ name: `${PREFIX}LOC-1` }, { name: `${PREFIX}LOC-2` }];

const REMARKS = [
  // docs/remarks-seed.json
  { remark_code: "COLOR-VAR", label: "Color variant / shade variation" },
  { remark_code: "MISPRINT", label: "Misprint" },
  { remark_code: "DESIGN-MISMATCH", label: "Design mismatch (wrong design)" },
  // On the dev database only; its label is what the seed's daily check for R11 expects.
  { remark_code: "DEFECT", label: "This is Defect" },
];

const MATERIAL_LIST = (Object.keys(MATERIALS) as MaterialKey[]).map((key) => ({
  key,
  material_code: MATERIALS[key],
}));

// ---- The plan, in the seed's write order -------------------------------------------------

function scenario(
  rolls: RollPlan[],
  movements: Movement[],
  lots: Record<string, { document_type: string; document_no: string }>,
  pick: (index: number) => { vendor: number; paper: number },
  vendorCount: number,
) {
  const vendorList = vendors(vendorCount);
  // writePlan's steps: every registration, then every movement, stably sorted by when saved.
  type Step = { saved: string; kind: "roll" | "movement"; index: number };
  const steps: Step[] = [
    ...rolls.map((roll, index): Step => ({ saved: at(`${roll.received} 08:00`), kind: "roll", index })),
    ...movements.map((move, index): Step => ({ saved: at(move.saved ?? move.date), kind: "movement", index })),
  ];
  steps.sort((a, b) => new Date(a.saved).getTime() - new Date(b.saved).getTime());
  const seqOf = new Map(steps.map((step, seq) => [`${step.kind}:${step.index}`, seq + 1]));

  const rollList = rolls.map((roll, index) => {
    const picked = pick(index);
    const vendor = vendorList[picked.vendor];
    return {
      seq: seqOf.get(`roll:${index}`),
      key: roll.name,
      roll_number: `${PREFIX}${roll.name}`,
      barcode: `${PREFIX}BC-${roll.name}`,
      material: MATERIALS[roll.material as MaterialKey],
      weight: roll.weight,
      unit: "kg",
      gsm: 60 + (index % 40),
      width: 900 + (index % 30) * 10,
      // The roll's own date; its IN row is dated this day (midnight UTC, as Node stores it).
      received: `2026-${roll.received}`,
      saved: at(`${roll.received} 08:00`),
      // A roll from before lots: created in the lot, then the lot taken off again.
      lot: roll.noLot ? null : roll.lot,
      lot_removed_after_create: Boolean(roll.noLot),
      vendor: vendor.vendor_code,
      paper: vendor.papers[picked.paper % vendor.papers.length],
      location: LOCATIONS[index % LOCATIONS.length].name,
    };
  });

  const movementList = movements.map((move, index) => ({
    seq: seqOf.get(`movement:${index}`),
    roll: move.roll,
    // DELETE is the roll's removal, not a movement: no ledger row, the roll and its rows go.
    type: move.type,
    date: at(move.date),
    saved: at(move.saved ?? move.date),
    ...(move.type === "OUT" ? { location: LOCATIONS[1].name, issued_to: move.issuedTo ?? "Line 1" } : {}),
    ...(move.back !== undefined ? { returned_weight: move.back } : {}),
    ...(move.counted !== undefined ? { new_weight: move.counted } : {}),
    ...(move.remarks ? { remarks: move.remarks } : {}),
    // Picked on the roll just before the movement (the roll's remark codes, replaced whole).
    ...(move.remarkCodes ? { roll_remark_codes: move.remarkCodes } : {}),
    photo: move.type !== "ADJUSTMENT" && move.type !== "DELETE",
  }));

  return {
    masters: { materials: MATERIAL_LIST, vendors: vendorList, locations: LOCATIONS, remarks: REMARKS },
    lots: Object.entries(lots).map(([key, lot]) => ({ key, ...lot })),
    rolls: rollList,
    movements: movementList,
  };
}

// ---- October ------------------------------------------------------------------------------

function october() {
  const base = scenario(ROLLS, MOVEMENTS, LOTS, (index) => ({ vendor: index % 2, paper: index }), 2);

  // By design: each roll's own October, added up under its first paper's RT|DELTA, upper-cased.
  const designOf = (p: { rt_code: string; delta_code: string }) =>
    `${p.rt_code.trim().toUpperCase()}|${p.delta_code.trim().toUpperCase()}`;
  const byDesign = new Map<string, number[]>();
  for (const roll of base.rolls) {
    const own = OCTOBER_BY_ROLL[roll.key];
    if (!own) continue;
    const key = designOf(roll.paper);
    const sum = byDesign.get(key) ?? [0, 0, 0, 0, 0, 0, 0, 0];
    own.forEach((v, i) => (sum[i] += v));
    byDesign.set(key, sum);
  }

  return {
    scenario: "october",
    source: "backend/src/utils/seedMonth.ts (ROLLS, MOVEMENTS, LOTS, EXPECTED, OCTOBER_BY_ROLL, DAILY)",
    figure_fields: FIELDS,
    ...base,
    expected: {
      // A material left out of a period has nothing at all in it.
      periods: EXPECTED.map((period) => ({
        label: period.label,
        from: period.from,
        to: period.to,
        figures: byMaterialCode(period.figures),
      })),
      by_roll: Object.fromEntries(Object.entries(OCTOBER_BY_ROLL).map(([roll, values]) => [roll, figures(values)])),
      october_by_design: Object.fromEntries([...byDesign].map(([key, values]) => [key, figures(values)])),
      // The seed's other October checks.
      detail: [
        { from: "2026-10-01", to: "2026-10-31", total_used: 1480, excludes_roll: "R14" },
        { from: "2026-10-08", to: "2026-10-08", rows: [{ roll: "R03", used: 150 }] },
      ],
      rolls_remaining_total: 1860,
      // Each check: the roll's row in the daily report for that day, or null for no row.
      daily: DAILY.map(({ date, roll, expect }) => ({ date, roll, expect })),
    },
  };
}

// ---- September (the bulk) -----------------------------------------------------------------

function september() {
  const plan = bulkPlan();
  const tally = computeBulkTally();
  const base = scenario(plan.rolls, plan.movements, BULK_LOTS, (index) => plan.picks[index], 6);
  const iso = (day: number) => `2026-09-${String(day).padStart(2, "0")}`;
  const STATUS_TEXT: Record<string, string> = {
    IN_STOCK: "In stock",
    ISSUED: "Out",
    CONSUMED: "Consumed",
    RETURNED_TO_VENDOR: "Returned to vendor",
    SOLD: "Sold",
  };

  // verifyBulk's periods: every day, every Monday-to-Sunday week, and the whole stretch.
  const periods: Array<[string, string, number, number]> = [];
  for (let d = 1; d <= 27; d++) periods.push([iso(d), iso(d), d, d]);
  periods.push(
    ["week 31 Aug to 6 Sep", "2026-08-31", 1, 6],
    ["week 7 to 13 Sep", iso(7), 7, 13],
    ["week 14 to 20 Sep", iso(14), 14, 20],
    ["week 21 to 27 Sep", iso(21), 21, 27],
    ["1 to 27 Sep", iso(1), 1, 27],
  );

  const dayEnd: Record<string, Record<string, unknown>> = {};
  for (const [day, rolls] of [...tally.dayEnd].sort((a, b) => a[0] - b[0])) {
    dayEnd[iso(day)] = Object.fromEntries(
      [...rolls].map(([roll, state]) => [
        roll,
        {
          remaining: state.remaining,
          status: state.status,
          status_label: STATUS_TEXT[state.status],
          movements: tally.movedOn.get(day)!.get(roll),
        },
      ]),
    );
  }

  return {
    scenario: "september",
    source: "backend/src/utils/seedMonth.ts (bulkPlan, computeBulkTally, BULK_LOTS)",
    figure_fields: FIELDS,
    ...base,
    expected: {
      periods: periods.map(([label, from, fromDay, toDay]) => ({
        label,
        from,
        to: iso(toDay),
        figures: byMaterialCode(tally.period(fromDay, toDay)),
      })),
      // Day -> roll -> where the roll stood after its last movement that day.
      daily: dayEnd,
      final_by_roll: Object.fromEntries(
        [...tally.finalByRoll].map(([roll, state]) => [
          roll,
          { remaining: state.remaining, status: state.status, material: MATERIALS[state.material] },
        ]),
      ),
      // Stock and out-on-floor at the end of 27 September, by material code.
      carry: Object.fromEntries(
        (Object.keys(tally.carry) as MaterialKey[]).map((key) => [MATERIALS[key], tally.carry[key]]),
      ),
    },
  };
}

function write(name: string, data: { rolls: unknown[]; movements: unknown[] }) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${path}: ${data.rolls.length} rolls, ${data.movements.length} movements`);
}

write("october.json", october());
write("september.json", september());
