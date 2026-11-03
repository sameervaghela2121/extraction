/**
 * A month of practice data, and a check of the reports against it. October 2026 on the dev
 * database: rolls through every kind of movement, with the figures each report should give
 * worked out by hand below, so a difference means a real bug.
 *
 *   npm run seed:month                    # dry run: what it would use, nothing written
 *   npm run seed:month -- --apply         # write the month
 *   npm run seed:month -- --verify        # compare the reports with the expected figures
 *   npm run seed:month -- --clean --apply # remove the month again
 *
 * Everything goes through the real validators and services, so the ledger and statuses are the
 * system's own. Only the entry time is simulated: a seeded row's createdAt is set afterwards, as
 * if it had been saved that day. updatedAt is left alone so tablets still pull the rows.
 *
 * Every seeded roll and lot starts with SEED-. Cleaning soft-deletes the rolls and movements,
 * the same way a tablet learns of any removal, and deletes the lots.
 */
import mongoose, { Types } from "mongoose";
import { randomUUID } from "crypto";
import { connectDb } from "../config/db";
import { env } from "../config/env";
import { Location } from "../models/Location.model";
import { Lot } from "../models/Lot.model";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { Remark } from "../models/Remark.model";
import { StockTransaction } from "../models/StockTransaction.model";
import { User } from "../models/User.model";
import { Vendor } from "../models/Vendor.model";
import { consumptionReportService } from "../services/consumptionReport.service";
import { dailyRollReportService } from "../services/dailyRollReport.service";
import { lotsService } from "../services/lots.service";
import { materialRollsService } from "../services/materialRolls.service";
import { stockService } from "../services/stock.service";
import { refreshSummary } from "../services/stockSummary.service";
import { logger } from "./logger";
import { createRollSchema } from "../validators/materialRolls.validators";
import { createLotSchema } from "../validators/lots.validators";
import { recordMovementSchema } from "../validators/stock.validators";

const PREFIX = "SEED-";
// One placeholder image each, uploaded once; every seeded record points at it.
const ROLL_PHOTO = "rolls/2026/10/00000000-0000-4000-8000-000000000001.jpg";
const LOT_PHOTO = "lots/2026/10/00000000-0000-4000-8000-000000000002.jpg";

type MaterialKey = "A" | "B" | "C";
const MATERIALS: Record<MaterialKey, string> = { A: "BASE-PAPER", B: "TISSUE", C: "BARRIER" };

/** An India-time moment, "MM-DD HH:mm" in 2026. */
const at = (when: string) => `2026-${when.replace(" ", "T")}:00+05:30`;

const LOTS = {
  L1: { document_type: "challan", document_no: `${PREFIX}CH-1001` },
  L2: { document_type: "invoice", document_no: `${PREFIX}INV-2001` },
  L3: { document_type: "challan", document_no: `${PREFIX}CH-1002` },
  L4: { document_type: "invoice", document_no: `${PREFIX}INV-2002` },
} as const;
type LotKey = keyof typeof LOTS;

interface RollPlan {
  name: string;
  material: MaterialKey;
  weight: number;
  received: string;
  lot: LotKey;
  /** A roll from before lots were required: its lot is taken off again after creating it. */
  noLot?: boolean;
}

/** The rolls, and what each one is for. */
const ROLLS: RollPlan[] = [
  // Received before the month: October's opening stock.
  { name: "R13", material: "A", weight: 100, received: "09-28", lot: "L1" },
  // Part used, then finished on a later trip.
  { name: "R01", material: "A", weight: 500, received: "10-01", lot: "L1" },
  // Marked consumed while out.
  { name: "R02", material: "A", weight: 400, received: "10-01", lot: "L1" },
  // Several movements on one day, ending out: the case the daily report's last row hides.
  { name: "R03", material: "A", weight: 600, received: "10-02", lot: "L1" },
  // Back to the vendor with remarks, one containing a comma.
  { name: "R04", material: "A", weight: 300, received: "10-02", lot: "L2" },
  // Older roll with no lot.
  { name: "R15", material: "A", weight: 120, received: "10-03", lot: "L1", noLot: true },
  // Sold, with no remark.
  { name: "R05", material: "B", weight: 250, received: "10-03", lot: "L2" },
  // Inward entered a day late, after another movement of the next day.
  { name: "R06", material: "B", weight: 350, received: "10-05", lot: "L2" },
  // Removed: must appear in no report.
  { name: "R14", material: "A", weight: 999, received: "10-06", lot: "L1" },
  // Out and back with nothing used.
  { name: "R07", material: "B", weight: 200, received: "10-16", lot: "L3" },
  // Counted lower, then still out at month end.
  { name: "R08", material: "B", weight: 450, received: "10-19", lot: "L3" },
  // Counted higher after use.
  { name: "R09", material: "C", weight: 300, received: "10-20", lot: "L4" },
  // Out at 23:59 on the 31st, back at 00:01 on the 1st: the month's boundary.
  { name: "R10", material: "C", weight: 180, received: "10-22", lot: "L4" },
  // Part used, then the rest back to the vendor, with a Hindi note.
  { name: "R11", material: "C", weight: 220, received: "10-26", lot: "L4" },
  // Received and never touched.
  { name: "R12", material: "C", weight: 150, received: "10-29", lot: "L4" },
];

interface Movement {
  roll: string;
  type: "OUT" | "RETURN" | "CONSUME" | "RETURN_TO_VENDOR" | "SELL" | "ADJUSTMENT" | "DELETE";
  /** The day the movement is dated. */
  date: string;
  /** When it was saved, if later than the date: a backdated entry. */
  saved?: string;
  back?: number;
  counted?: number;
  remarks?: string;
  remarkCodes?: string[];
}

const MOVEMENTS: Movement[] = [
  { roll: "R13", type: "OUT", date: "10-01 10:00" },
  { roll: "R13", type: "RETURN", date: "10-02 16:00", back: 40 },
  { roll: "R01", type: "OUT", date: "10-05 09:00" },
  { roll: "R01", type: "RETURN", date: "10-05 17:00", back: 300 },
  { roll: "R02", type: "OUT", date: "10-06 10:00" },
  { roll: "R14", type: "DELETE", date: "10-07 09:00" },
  { roll: "R02", type: "CONSUME", date: "10-07 15:00" },
  { roll: "R03", type: "OUT", date: "10-08 09:00" },
  { roll: "R03", type: "RETURN", date: "10-08 13:00", back: 450 },
  { roll: "R03", type: "OUT", date: "10-08 15:00" },
  { roll: "R03", type: "RETURN", date: "10-09 11:00", back: 400 },
  { roll: "R15", type: "OUT", date: "10-09 12:00" },
  { roll: "R15", type: "RETURN", date: "10-10 12:00", back: 0 },
  { roll: "R01", type: "OUT", date: "10-12 09:00" },
  { roll: "R01", type: "RETURN", date: "10-12 18:00", back: 0 },
  {
    roll: "R04",
    type: "RETURN_TO_VENDOR",
    date: "10-13 11:00",
    remarks: "Shade off, edges damaged",
    remarkCodes: ["COLOR-VAR", "MISPRINT"],
  },
  { roll: "R05", type: "SELL", date: "10-14 11:00" },
  { roll: "R06", type: "OUT", date: "10-15 10:00" },
  // Dated the 15th, saved on the 16th, after R07's movements of the 16th began.
  { roll: "R06", type: "RETURN", date: "10-15 18:00", saved: "10-16 12:00", back: 250 },
  { roll: "R07", type: "OUT", date: "10-16 10:00" },
  { roll: "R07", type: "RETURN", date: "10-16 17:00", back: 200 },
  { roll: "R08", type: "ADJUSTMENT", date: "10-20 09:00", counted: 430, remarks: "Stock count: 20 kg short" },
  { roll: "R08", type: "OUT", date: "10-21 09:00" },
  { roll: "R09", type: "OUT", date: "10-21 10:00" },
  { roll: "R09", type: "RETURN", date: "10-21 18:00", back: 250 },
  { roll: "R09", type: "ADJUSTMENT", date: "10-23 09:00", counted: 260, remarks: "Stock count: 10 kg over" },
  { roll: "R11", type: "OUT", date: "10-27 10:00" },
  { roll: "R11", type: "RETURN", date: "10-27 18:00", back: 170 },
  {
    roll: "R11",
    type: "RETURN_TO_VENDOR",
    date: "10-28 11:00",
    remarks: "किनारा फटा हुआ",
    remarkCodes: ["DEFECT"],
  },
  { roll: "R10", type: "OUT", date: "10-31 23:59" },
  { roll: "R10", type: "RETURN", date: "11-01 00:01", back: 130 },
];

/** opening, received, consumed, returned to vendor, sold, adjusted, closing, out at close.
 *  A material left out is expected to have nothing at all in that period. */
type Expected = [number, number, number, number, number, number, number, number];
const EXPECTED: Array<{ label: string; from: string; to: string; figures: Partial<Record<MaterialKey, Expected>> }> = [
  {
    label: "October",
    from: "2026-10-01",
    to: "2026-10-31",
    figures: {
      A: [100, 1920, 1280, 300, 0, 0, 440, 0],
      B: [0, 1250, 100, 0, 250, -20, 880, 430],
      C: [0, 850, 100, 170, 0, 10, 590, 180],
    },
  },
  {
    label: "Week 28 Sep to 4 Oct",
    from: "2026-09-28",
    to: "2026-10-04",
    figures: { A: [0, 2020, 60, 0, 0, 0, 1960, 0], B: [0, 250, 0, 0, 0, 0, 250, 0] },
  },
  {
    label: "Week 5 to 11 Oct",
    from: "2026-10-05",
    to: "2026-10-11",
    figures: { A: [1960, 0, 920, 0, 0, 0, 1040, 0], B: [250, 350, 0, 0, 0, 0, 600, 0] },
  },
  {
    label: "Week 12 to 18 Oct",
    from: "2026-10-12",
    to: "2026-10-18",
    figures: { A: [1040, 0, 300, 300, 0, 0, 440, 0], B: [600, 200, 100, 0, 250, 0, 450, 0] },
  },
  {
    label: "Week 19 to 25 Oct",
    from: "2026-10-19",
    to: "2026-10-25",
    figures: {
      A: [440, 0, 0, 0, 0, 0, 440, 0],
      B: [450, 450, 0, 0, 0, -20, 880, 430],
      C: [0, 480, 50, 0, 0, 10, 440, 0],
    },
  },
  {
    label: "Week 26 Oct to 1 Nov",
    from: "2026-10-26",
    to: "2026-11-01",
    figures: {
      A: [440, 0, 0, 0, 0, 0, 440, 0],
      B: [880, 0, 0, 0, 0, 0, 880, 430],
      C: [440, 370, 100, 170, 0, 0, 540, 0],
    },
  },
  {
    label: "8 Oct: three movements on one roll",
    from: "2026-10-08",
    to: "2026-10-08",
    figures: { A: [1360, 0, 150, 0, 0, 0, 1210, 450], B: [600, 0, 0, 0, 0, 0, 600, 0] },
  },
  {
    label: "15 Oct: inward entered a day late",
    from: "2026-10-15",
    to: "2026-10-15",
    figures: { A: [440, 0, 0, 0, 0, 0, 440, 0], B: [350, 0, 100, 0, 0, 0, 250, 0] },
  },
  {
    label: "16 Oct: out and back, nothing used",
    from: "2026-10-16",
    to: "2026-10-16",
    figures: { A: [440, 0, 0, 0, 0, 0, 440, 0], B: [250, 200, 0, 0, 0, 0, 450, 0] },
  },
  {
    label: "30 Oct: nothing moved",
    from: "2026-10-30",
    to: "2026-10-30",
    figures: {
      A: [440, 0, 0, 0, 0, 0, 440, 0],
      B: [880, 0, 0, 0, 0, 0, 880, 430],
      C: [590, 0, 0, 0, 0, 0, 590, 0],
    },
  },
  {
    label: "31 Oct: out at 23:59",
    from: "2026-10-31",
    to: "2026-10-31",
    figures: {
      A: [440, 0, 0, 0, 0, 0, 440, 0],
      B: [880, 0, 0, 0, 0, 0, 880, 430],
      C: [590, 0, 0, 0, 0, 0, 590, 180],
    },
  },
  {
    label: "1 Nov: back at 00:01",
    from: "2026-11-01",
    to: "2026-11-01",
    figures: {
      A: [440, 0, 0, 0, 0, 0, 440, 0],
      B: [880, 0, 0, 0, 0, 0, 880, 430],
      C: [590, 0, 50, 0, 0, 0, 540, 0],
    },
  },
];

/** Each roll's own October, in the same order as above. R14 is removed, so it has none. */
const OCTOBER_BY_ROLL: Record<string, Expected> = {
  R13: [100, 0, 60, 0, 0, 0, 40, 0],
  R01: [0, 500, 500, 0, 0, 0, 0, 0],
  R02: [0, 400, 400, 0, 0, 0, 0, 0],
  R03: [0, 600, 200, 0, 0, 0, 400, 0],
  R04: [0, 300, 0, 300, 0, 0, 0, 0],
  R15: [0, 120, 120, 0, 0, 0, 0, 0],
  R05: [0, 250, 0, 0, 250, 0, 0, 0],
  R06: [0, 350, 100, 0, 0, 0, 250, 0],
  R07: [0, 200, 0, 0, 0, 0, 200, 0],
  R08: [0, 450, 0, 0, 0, -20, 430, 430],
  R09: [0, 300, 50, 0, 0, 10, 260, 0],
  R10: [0, 180, 0, 0, 0, 0, 180, 180],
  R11: [0, 220, 50, 170, 0, 0, 0, 0],
  R12: [0, 150, 0, 0, 0, 0, 150, 0],
};

/** What the daily roll report should say about a roll on a day. */
const DAILY: Array<{ date: string; roll: string; expect: Record<string, string | number> | null }> = [
  { date: "2026-10-08", roll: "R03", expect: { "Final weight": 450, "Final status": "Out", "Last movement": "Outward", "Movements that day": 3 } },
  { date: "2026-10-09", roll: "R03", expect: { "Final weight": 400, "Final status": "In stock", "Weight used": 50 } },
  { date: "2026-10-13", roll: "R04", expect: { "Final weight": 0, "Final status": "Returned to vendor", "Lot type": "Invoice", Remarks: "Color variant / shade variation, Misprint", "Movement note": "Shade off, edges damaged" } },
  { date: "2026-10-14", roll: "R05", expect: { "Final weight": 0, "Final status": "Sold", Remarks: "" } },
  { date: "2026-10-15", roll: "R06", expect: { "Final weight": 250, "Final status": "In stock", "Weight used": 100 } },
  // Saved on the 16th but dated the 15th, so the roll did not move on the 16th.
  { date: "2026-10-16", roll: "R06", expect: null },
  { date: "2026-10-16", roll: "R07", expect: { "Final weight": 200, "Final status": "In stock", "Weight used": 0, "Movements that day": 3 } },
  { date: "2026-10-20", roll: "R08", expect: { "Final weight": 430, "Final status": "In stock", "Last movement": "Adjusted", "Movement note": "Stock count: 20 kg short" } },
  { date: "2026-10-10", roll: "R15", expect: { "Final weight": 0, "Final status": "Consumed", "Lot type": "" } },
  { date: "2026-10-28", roll: "R11", expect: { "Final status": "Returned to vendor", "Movement note": "किनारा फटा हुआ", Remarks: "This is Defect" } },
  { date: "2026-10-29", roll: "R12", expect: { "Final weight": 150, "Final status": "In stock", "Last movement": "Received", "Lot type": "Invoice" } },
  { date: "2026-10-30", roll: "R12", expect: null },
  { date: "2026-10-31", roll: "R10", expect: { "Final weight": 180, "Final status": "Out" } },
  { date: "2026-11-01", roll: "R10", expect: { "Final weight": 130, "Final status": "In stock", "Weight used": 50 } },
  // Removed.
  { date: "2026-10-06", roll: "R14", expect: null },
];

async function seededRolls() {
  return MaterialRoll.find({ roll_number: new RegExp(`^${PREFIX}`), deleted_at: null }).lean();
}

/** Stamps when a row was saved. Through the driver, so updatedAt stays as written: a tablet's
 *  delta pull needs it. */
async function stampSaved(model: mongoose.Model<never>, id: Types.ObjectId, when: string) {
  await model.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(when) } });
}

async function apply() {
  if ((await seededRolls()).length > 0) {
    throw new Error("Seeded rolls are already here. Clean them first: --clean --apply");
  }
  const user = await User.findOne({ role: "godown_supervisor" }).select("_id").lean();
  if (!user) throw new Error("No godown_supervisor to record these under");
  const userId = user._id.toString();

  const materials = new Map<MaterialKey, string>();
  for (const [key, code] of Object.entries(MATERIALS) as Array<[MaterialKey, string]>) {
    const material = await RawMaterial.findOne({ material_code: code }).select("_id").lean();
    if (!material) throw new Error(`Material ${code} is missing`);
    materials.set(key, material._id.toString());
  }
  const vendors = await Vendor.find({ status: "active", "papers.0": { $exists: true } }).limit(2).lean();
  const locations = await Location.find({ status: "active" }).select("_id").limit(2).lean();
  if (vendors.length < 2 || locations.length < 2) throw new Error("Needs two vendors with papers and two locations");

  const lots = new Map<LotKey, string>();
  for (const [key, lot] of Object.entries(LOTS) as Array<[LotKey, (typeof LOTS)[LotKey]]>) {
    const created = await lotsService.create(
      createLotSchema.parse({ ...lot, document_photo_path: LOT_PHOTO, client_id: randomUUID() }),
      userId,
    );
    lots.set(key, created.id);
  }

  // Everything in the order it would have been saved: registrations and movements together.
  type Step = { saved: string; run: () => Promise<void> };
  const rollIds = new Map<string, string>();
  const materialOf = new Map(ROLLS.map((r) => [r.name, materials.get(r.material)!]));
  const steps: Step[] = [];

  ROLLS.forEach((plan, index) => {
    const saved = at(`${plan.received} 08:00`);
    steps.push({
      saved,
      run: async () => {
        const vendor = vendors[index % vendors.length];
        const roll = await materialRollsService.create(
          createRollSchema.parse({
            roll_number: `${PREFIX}${plan.name}`,
            barcode: `${PREFIX}BC-${plan.name}`,
            material_id: materials.get(plan.material),
            vendor_id: vendor._id.toString(),
            lot_id: lots.get(plan.lot),
            papers: [vendor.papers![index % vendor.papers!.length]],
            weight: plan.weight,
            gsm: 70 + index,
            width: 900 + index * 10,
            location: locations[index % locations.length]._id.toString(),
            date: `2026-${plan.received}`,
            side1_photo_path: ROLL_PHOTO,
            side2_photo_path: ROLL_PHOTO,
            client_id: randomUUID(),
          }) as never,
          userId,
        );
        rollIds.set(plan.name, roll.id);
        const rollId = new Types.ObjectId(roll.id);
        const receipt = await StockTransaction.findOne({ roll_id: rollId, transaction_type: "IN" }).select("_id").lean();
        await stampSaved(StockTransaction as never, receipt!._id, saved);
        await stampSaved(MaterialRoll as never, rollId, saved);
        if (plan.noLot) await MaterialRoll.collection.updateOne({ _id: rollId }, { $unset: { lot_id: "" } });
      },
    });
  });

  for (const move of MOVEMENTS) {
    const saved = at(move.saved ?? move.date);
    steps.push({
      saved,
      run: async () => {
        const rollId = rollIds.get(move.roll)!;
        if (move.type === "DELETE") {
          await materialRollsService.remove(rollId, userId);
          return;
        }
        if (move.remarkCodes) {
          const remarks = await Remark.find({ remark_code: { $in: move.remarkCodes } }).select("_id").lean();
          await materialRollsService.updateRemarkCodes(rollId, remarks.map((r) => r._id.toString()));
        }
        const body = recordMovementSchema.parse({
          transaction_type: move.type,
          transaction_date: at(move.date),
          recorded_at: saved,
          material_id: materialOf.get(move.roll),
          roll_id: rollId,
          ...(move.type === "OUT" ? { location: locations[1]._id.toString(), issued_to: "Line 1" } : {}),
          ...(move.back !== undefined ? { returned_weight: move.back } : {}),
          ...(move.counted !== undefined ? { new_weight: move.counted } : {}),
          ...(move.remarks ? { remarks: move.remarks } : {}),
          ...(move.type !== "ADJUSTMENT" ? { photo_paths: [ROLL_PHOTO] } : {}),
          client_id: randomUUID(),
        });
        const row = await stockService.recordMovement(body as never, userId);
        await stampSaved(StockTransaction as never, new Types.ObjectId(row.id), saved);
      },
    });
  }

  steps.sort((a, b) => new Date(a.saved).getTime() - new Date(b.saved).getTime());
  for (const step of steps) await step.run();
  logger.info(`written: ${ROLLS.length} rolls, ${LOTS ? Object.keys(LOTS).length : 0} lots, ${MOVEMENTS.length} movements`);
}

async function clean() {
  const rolls = await seededRolls();
  const now = new Date();
  await MaterialRoll.updateMany({ _id: { $in: rolls.map((r) => r._id) } }, { $set: { deleted_at: now } });
  await StockTransaction.updateMany({ roll_id: { $in: rolls.map((r) => r._id) } }, { $set: { deleted_at: now } });
  const lots = await Lot.deleteMany({ document_no: new RegExp(`^${PREFIX}`) });
  for (const id of new Set(rolls.map((r) => r.material_id.toString()))) await refreshSummary(new Types.ObjectId(id));
  logger.info(`removed: ${rolls.length} rolls and their movements, ${lots.deletedCount} lots`);
}

async function verify(): Promise<number> {
  let failures = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    if (!ok) failures++;
    logger.info(`${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  ${detail}` : ""}`);
  };
  const fields = ["opening", "received", "consumed", "returned_to_vendor", "sold", "adjusted", "closing", "out_at_close"] as const;

  for (const period of EXPECTED) {
    const { rows, totals } = await consumptionReportService.summary(period.from, period.to);
    const sums = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const key of Object.keys(MATERIALS) as MaterialKey[]) {
      const row = rows.find((r) => r.material_code === MATERIALS[key]);
      const actual = fields.map((f) => row?.[f] ?? 0);
      const expected = period.figures[key] ?? [0, 0, 0, 0, 0, 0, 0, 0];
      expected.forEach((v, i) => (sums[i] += v));
      check(
        actual.join() === expected.join(),
        `${period.label}: ${MATERIALS[key]}`,
        `expected ${expected.join(" ")}, got ${actual.join(" ")}`,
      );
    }
    check(fields.map((f) => totals[f]).join() === sums.join(), `${period.label}: totals`, `expected ${sums.join(" ")}, got ${fields.map((f) => totals[f]).join(" ")}`);
    for (const row of rows) {
      const worked = row.opening + row.received - row.consumed - row.returned_to_vendor - row.sold + row.adjusted;
      check(Math.abs(worked - row.closing) < 0.001, `${period.label}: ${row.material_code} reconciles`, `worked ${worked}, closing ${row.closing}`);
    }
  }

  // October by design: each roll's figures by hand, added up under whichever design it carries.
  const designKey = (paper?: { royal_touche_code?: string; delta_code?: string }) =>
    `${paper?.royal_touche_code?.trim().toUpperCase() ?? ""}|${paper?.delta_code?.trim().toUpperCase() ?? ""}`;
  const expectedByDesign = new Map<string, Expected>();
  for (const roll of await seededRolls()) {
    const own = OCTOBER_BY_ROLL[roll.roll_number.slice(PREFIX.length)];
    if (!own) continue;
    const key = designKey(roll.papers?.[0]);
    const sum = expectedByDesign.get(key) ?? ([0, 0, 0, 0, 0, 0, 0, 0] as Expected);
    own.forEach((v, i) => (sum[i] += v));
    expectedByDesign.set(key, sum);
  }
  const byDesign = await consumptionReportService.summary("2026-10-01", "2026-10-31", "design");
  check(byDesign.rows.length === expectedByDesign.size, "October by design: one row per design", `expected ${expectedByDesign.size}, got ${byDesign.rows.length}`);
  for (const row of byDesign.rows) {
    const key = designKey({ royal_touche_code: row.rt_code, delta_code: row.delta_code });
    const expected = expectedByDesign.get(key);
    const actual = fields.map((f) => row[f]);
    check(actual.join() === expected?.join(), `October by design: ${key}`, `expected ${expected?.join(" ")}, got ${actual.join(" ")}`);
    check(Boolean(row.vendor) && Boolean(row.material), `October by design: ${key} names its vendor and material`);
  }
  const byMaterial = await consumptionReportService.summary("2026-10-01", "2026-10-31");
  check(
    fields.every((f) => byDesign.totals[f] === byMaterial.totals[f]),
    "October by design adds up to the same totals as by material",
  );
  check(
    byDesign.rows.every((row, i) => i === 0 || byDesign.rows[i - 1].consumed >= row.consumed),
    "October by design is busiest first",
  );

  // The detail must back the summary's Consumed column, line for line.
  const month = await consumptionReportService.detail("2026-10-01", "2026-10-31");
  check(month.reduce((sum, row) => sum + row.used, 0) === 1480, "October detail adds up to the summary's 1480 kg");
  check(!month.some((row) => row.roll_number === `${PREFIX}R14`), "October detail leaves out the removed roll");
  const day = await consumptionReportService.detail("2026-10-08", "2026-10-08");
  check(day.length === 1 && day[0].roll_number === `${PREFIX}R03` && day[0].used === 150, "8 Oct detail is the one 150 kg use");

  // Stock closing the month as the rolls say now, for the materials with no later movement.
  const rolls = await seededRolls();
  const onRolls = rolls.reduce((sum, r) => sum + (r.remaining_weight ?? 0), 0);
  check(onRolls === 1860, "the rolls' own weights match the 1 Nov closing total", `got ${onRolls}`);

  for (const { date, roll, expect } of DAILY) {
    const rows = await dailyRollReportService.rows(date);
    const row = rows.find((r) => r["Roll number"] === `${PREFIX}${roll}`);
    if (!expect) {
      check(!row, `${date} ${roll}: not in the daily report`);
      continue;
    }
    if (!row) {
      check(false, `${date} ${roll}: in the daily report`, "missing");
      continue;
    }
    for (const [column, value] of Object.entries(expect)) {
      const actual = row[column as keyof typeof row] ?? "";
      check(actual === value, `${date} ${roll}: ${column}`, `expected "${value}", got "${actual}"`);
    }
  }
  logger.info(failures ? `${failures} FAILED` : "all checks passed");
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  if (env.mongodbUri.toLowerCase().includes("prod")) throw new Error("This looks like production. Dev only.");
  await connectDb();
  let failures = 0;
  if (args.includes("--verify")) {
    failures = await verify();
  } else if (args.includes("--clean")) {
    if (args.includes("--apply")) await clean();
    else logger.info(`dry run: ${(await seededRolls()).length} seeded rolls would be removed. Re-run with --apply.`);
  } else if (args.includes("--apply")) {
    await apply();
  } else {
    logger.info(`dry run: ${ROLLS.length} rolls, ${MOVEMENTS.length} movements. Already seeded: ${(await seededRolls()).length}. Re-run with --apply.`);
  }
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  logger.error("seed:month failed:", err);
  process.exit(1);
});
