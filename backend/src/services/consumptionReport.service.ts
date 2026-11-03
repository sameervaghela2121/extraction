import { Types } from "mongoose";
import { Location } from "../models/Location.model";
import { Lot } from "../models/Lot.model";
import { MaterialRoll, type RollStatus } from "../models/MaterialRoll.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { StockTransaction, type IStockTransaction } from "../models/StockTransaction.model";
import { Vendor } from "../models/Vendor.model";
import { csvCell, istDayRange, statusAfter } from "./dailyRollReport.service";

/** What one row of the report stands for. A design is a paper's RT and Delta codes together:
 *  either can be missing, and the pair is what tells a Delta-only paper from an RT-only one. */
export type ConsumptionGroup = "material" | "design";

/** One material over a period, in kg. Closing = opening + received - consumed - returned to
 *  vendor - sold + adjusted, and closing includes what is out on the floor at the period's end. */
export interface ConsumptionRow {
  material_code: string;
  material: string;
  /** Design rows only. A design's material and vendor read from its rolls; both can be several,
   *  since the same codes are on file under more than one vendor. */
  rt_code?: string;
  delta_code?: string;
  vendor?: string;
  opening: number;
  received: number;
  consumed: number;
  returned_to_vendor: number;
  sold: number;
  adjusted: number;
  closing: number;
  out_at_close: number;
}

type Figures = Omit<ConsumptionRow, "material_code" | "material" | "rt_code" | "delta_code" | "vendor">;
const FIGURES: Array<keyof Figures> = [
  "opening",
  "received",
  "consumed",
  "returned_to_vendor",
  "sold",
  "adjusted",
  "closing",
  "out_at_close",
];

const emptyFigures = (): Figures => ({
  opening: 0,
  received: 0,
  consumed: 0,
  returned_to_vendor: 0,
  sold: 0,
  adjusted: 0,
  closing: 0,
  out_at_close: 0,
});

/** Weights are decimals, and summing them drifts: 0.1 + 0.2 must not print 0.30000000000000004. */
const kg = (value: number) => Math.round(value * 1000) / 1000;

type LedgerRow = Pick<
  IStockTransaction,
  | "_id"
  | "transaction_type"
  | "transaction_date"
  | "material_id"
  | "weight"
  | "roll_weight_after"
  | "from_location"
  | "issued_to"
  | "remarks"
> & { roll_id: Types.ObjectId };

interface LiveRoll {
  _id: Types.ObjectId;
  vendor_id?: Types.ObjectId;
  papers?: Array<{ royal_touche_code?: string; delta_code?: string }>;
}

interface DesignMembers {
  paper?: { royal_touche_code?: string; delta_code?: string };
  vendors: Set<string>;
  materials: Set<string>;
}

/** A roll's design, by its first paper: the app and the website book a roll against one. Codes
 *  are compared without regard to case or stray spaces, as they were typed in by hand. */
function designKey(roll: LiveRoll): string {
  const paper = roll.papers?.[0];
  const code = (value?: string) => value?.trim().toUpperCase() ?? "";
  return `${code(paper?.royal_touche_code)}|${code(paper?.delta_code)}`;
}

interface ConsumedRow {
  row: LedgerRow;
  used: number;
  /** Who took the roll: recorded on its Outward, not on the movement that says what was used. */
  issuedTo?: string;
}

/**
 * Walks every movement of every live roll, in the order they were written, because each row's
 * figures were worked out in that order. What a row changed is the difference from the row
 * before it; the row's own date then decides which period that change belongs to. So a movement
 * entered late, after a later-dated one on the same roll, still lands on its own day and every
 * period's figures add up. A removed roll is left out, and so are rows whose roll no longer
 * exists.
 */
async function walkLedger(from: string, to: string, group: ConsumptionGroup = "material") {
  const start = istDayRange(from).start;
  const end = istDayRange(to).end;
  const liveRolls = await MaterialRoll.find({ deleted_at: null })
    .select("papers vendor_id")
    .lean<LiveRoll[]>();
  const live = new Map(liveRolls.map((r) => [r._id.toString(), r]));

  const figures = new Map<string, Figures>();
  const members = new Map<string, DesignMembers>();
  const consumed: ConsumedRow[] = [];
  const keyOf = (row: LedgerRow, roll: LiveRoll) =>
    group === "material" ? row.material_id.toString() : designKey(roll);
  const bucket = (key: string) => {
    let found = figures.get(key);
    if (!found) {
      found = emptyFigures();
      figures.set(key, found);
    }
    return found;
  };

  const rows = StockTransaction.aggregate<LedgerRow>([
    { $match: { deleted_at: null, roll_id: { $exists: true, $ne: null } } },
    { $sort: { roll_id: 1, createdAt: 1, _id: 1 } },
    {
      $project: {
        transaction_type: 1,
        transaction_date: 1,
        material_id: 1,
        roll_id: 1,
        weight: 1,
        roll_weight_after: 1,
        from_location: 1,
        issued_to: 1,
        remarks: 1,
      },
    },
  ])
    .allowDiskUse(true)
    .cursor();

  // One roll at a time: rows arrive grouped by roll.
  let currentRoll: string | undefined;
  let issuedTo: string | undefined;
  let weight = 0;
  let weightAtClose = 0;
  let statusAtClose: RollStatus | undefined;
  let keyAtClose: string | undefined;
  const closeRoll = () => {
    if (keyAtClose && statusAtClose === "ISSUED") bucket(keyAtClose).out_at_close += weightAtClose;
  };

  for await (const row of rows) {
    const key = row.roll_id.toString();
    const roll = live.get(key);
    if (!roll) continue;
    if (key !== currentRoll) {
      closeRoll();
      currentRoll = key;
      issuedTo = undefined;
      weight = 0;
      weightAtClose = 0;
      statusAtClose = undefined;
      keyAtClose = undefined;
    }
    const after = row.roll_weight_after ?? weight;
    const change = after - weight;
    weight = after;
    if (row.transaction_type === "OUT") issuedTo = row.issued_to;
    const date = new Date(row.transaction_date);
    if (date >= end) continue;

    weightAtClose += change;
    statusAtClose = statusAfter(row, statusAtClose);
    keyAtClose = keyOf(row, roll);
    const material = bucket(keyAtClose);
    if (group === "design") {
      let found = members.get(keyAtClose);
      if (!found) {
        found = { paper: roll.papers?.[0], vendors: new Set(), materials: new Set() };
        members.set(keyAtClose, found);
      }
      if (roll.vendor_id) found.vendors.add(roll.vendor_id.toString());
      found.materials.add(row.material_id.toString());
    }
    material.closing += change;
    if (date < start) {
      material.opening += change;
      continue;
    }
    switch (row.transaction_type) {
      case "IN":
        material.received += change;
        break;
      case "RETURN":
      case "CONSUME":
        material.consumed -= change;
        if (change !== 0) consumed.push({ row, used: -change, issuedTo });
        break;
      case "RETURN_TO_VENDOR":
        material.returned_to_vendor -= change;
        break;
      case "SELL":
        material.sold -= change;
        break;
      // ADJUSTMENT, and any correction carried on another row. An OUT changes nothing.
      default:
        material.adjusted += change;
    }
  }
  closeRoll();
  return { figures, consumed, members };
}

const FIGURE_COLUMNS: Array<[string, keyof Figures]> = [
  ["Opening (kg)", "opening"],
  ["Received (kg)", "received"],
  ["Consumed (kg)", "consumed"],
  ["Returned to vendor (kg)", "returned_to_vendor"],
  ["Sold (kg)", "sold"],
  ["Adjusted (kg)", "adjusted"],
  ["Closing (kg)", "closing"],
  ["Out on floor at close (kg)", "out_at_close"],
];

/** The columns naming a row, and which of them carries the word Total on the last line. */
const NAME_COLUMNS: Record<ConsumptionGroup, { columns: Array<[string, keyof ConsumptionRow]>; total: keyof ConsumptionRow }> = {
  material: {
    columns: [
      ["Material code", "material_code"],
      ["Material", "material"],
    ],
    total: "material",
  },
  design: {
    columns: [
      ["RT code", "rt_code"],
      ["Delta code", "delta_code"],
      ["Vendor", "vendor"],
      ["Material", "material"],
    ],
    total: "rt_code",
  },
};

function toCsv(header: string[], lines: Array<Array<string | number | undefined>>): string {
  const body = [header.map(csvCell).join(",")];
  for (const line of lines) body.push(line.map(csvCell).join(","));
  // The byte-order mark, for the same reason as the daily report: Excel and Hindi or Gujarati.
  return `﻿${body.join("\r\n")}\r\n`;
}

export const consumptionReportService = {
  /** One row per material or design that had stock or a movement in the period, and their
   *  total. Materials read alphabetically; designs, of which there are many, busiest first. */
  async summary(from: string, to: string, group: ConsumptionGroup = "material") {
    const { figures, members } = await walkLedger(from, to, group);
    const allMembers = [...members.values()];
    const materialIds = group === "material" ? [...figures.keys()] : allMembers.flatMap((m) => [...m.materials]);
    const [materials, vendors] = await Promise.all([
      RawMaterial.find({ _id: { $in: materialIds.map((id) => new Types.ObjectId(id)) } })
        .select("name material_code")
        .lean<Array<{ _id: Types.ObjectId; name: string; material_code: string }>>(),
      Vendor.find({ _id: { $in: allMembers.flatMap((m) => [...m.vendors]).map((id) => new Types.ObjectId(id)) } })
        .select("name")
        .lean<Array<{ _id: Types.ObjectId; name: string }>>(),
    ]);
    const names = new Map(materials.map((m) => [m._id.toString(), m]));
    const vendorNames = new Map(vendors.map((v) => [v._id.toString(), v.name]));
    const listed = (ids: Set<string>, nameOf: (id: string) => string | undefined) =>
      [...ids].map(nameOf).filter(Boolean).sort().join(", ");

    const rows: ConsumptionRow[] = [...figures.entries()]
      .map(([key, values]): ConsumptionRow => {
        const rounded = emptyFigures();
        for (const field of FIGURES) rounded[field] = kg(values[field]);
        if (group === "material") {
          return {
            material_code: names.get(key)?.material_code ?? "",
            material: names.get(key)?.name ?? "",
            ...rounded,
          };
        }
        const member = members.get(key);
        return {
          material_code: "",
          material: member ? listed(member.materials, (id) => names.get(id)?.name) : "",
          rt_code: member?.paper?.royal_touche_code ?? "",
          delta_code: member?.paper?.delta_code ?? "",
          vendor: member ? listed(member.vendors, (id) => vendorNames.get(id)) : "",
          ...rounded,
        };
      })
      .filter((row) => FIGURES.some((field) => row[field] !== 0))
      .sort((a, b) =>
        group === "material"
          ? a.material.localeCompare(b.material)
          : b.consumed - a.consumed || (a.rt_code ?? "").localeCompare(b.rt_code ?? "", "en", { numeric: true }),
      );

    const totals = emptyFigures();
    for (const row of rows) for (const field of FIGURES) totals[field] = kg(totals[field] + row[field]);
    return { from, to, group, rows, totals };
  },

  async summaryCsv(from: string, to: string, group: ConsumptionGroup = "material"): Promise<string> {
    const { rows, totals } = await this.summary(from, to, group);
    const { columns, total } = NAME_COLUMNS[group];
    const lines: Array<Array<string | number | undefined>> = rows.map((row) => [
      ...columns.map(([, field]) => row[field]),
      ...FIGURE_COLUMNS.map(([, field]) => row[field]),
    ]);
    lines.push([
      ...columns.map(([, field]) => (field === total ? "Total" : "")),
      ...FIGURE_COLUMNS.map(([, field]) => totals[field]),
    ]);
    return toCsv([...columns, ...FIGURE_COLUMNS].map(([label]) => label), lines);
  },

  /** The proof behind the summary's Consumed column: one line per movement that used weight. */
  async detail(from: string, to: string) {
    const { consumed } = await walkLedger(from, to);
    const rolls = await MaterialRoll.find({ _id: { $in: consumed.map((c) => c.row.roll_id) } })
      .select("roll_number barcode lot_id papers")
      .lean<
        Array<{
          _id: Types.ObjectId;
          roll_number: string;
          barcode?: string;
          lot_id?: Types.ObjectId;
          papers?: Array<{ royal_touche_code?: string; delta_code?: string }>;
        }>
      >();
    const rollById = new Map(rolls.map((r) => [r._id.toString(), r]));
    const [materials, lots, locations] = await Promise.all([
      RawMaterial.find({ _id: { $in: consumed.map((c) => c.row.material_id) } })
        .select("name material_code")
        .lean<Array<{ _id: Types.ObjectId; name: string; material_code: string }>>(),
      Lot.find({ _id: { $in: rolls.map((r) => r.lot_id).filter(Boolean) } })
        .select("document_type document_no")
        .lean<Array<{ _id: Types.ObjectId; document_type: string; document_no: string }>>(),
      Location.find({ _id: { $in: consumed.map((c) => c.row.from_location).filter(Boolean) } })
        .select("name")
        .lean<Array<{ _id: Types.ObjectId; name: string }>>(),
    ]);
    const materialById = new Map(materials.map((m) => [m._id.toString(), m]));
    const lotById = new Map(lots.map((l) => [l._id.toString(), l]));
    const locationById = new Map(locations.map((l) => [l._id.toString(), l.name]));

    return consumed
      .map(({ row, used, issuedTo }) => {
        const roll = rollById.get(row.roll_id.toString());
        const lot = roll?.lot_id ? lotById.get(roll.lot_id.toString()) : undefined;
        const material = materialById.get(row.material_id.toString());
        return {
          // India's day, however the instant is stored.
          date: new Date(new Date(row.transaction_date).getTime() + 330 * 60 * 1000).toISOString().slice(0, 10),
          roll_number: roll?.roll_number ?? "",
          barcode: roll?.barcode,
          material_code: material?.material_code ?? "",
          material: material?.name ?? "",
          rt_code: roll?.papers?.[0]?.royal_touche_code,
          delta_code: roll?.papers?.[0]?.delta_code,
          used: kg(used),
          left_on_roll: row.roll_weight_after ?? 0,
          lot_type: lot ? (lot.document_type === "invoice" ? "Invoice" : "Challan") : undefined,
          document_no: lot?.document_no,
          used_at: row.from_location ? locationById.get(row.from_location.toString()) : undefined,
          issued_to: issuedTo,
          note: row.remarks,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.roll_number.localeCompare(b.roll_number, "en", { numeric: true }));
  },

  async detailCsv(from: string, to: string): Promise<string> {
    const rows = await this.detail(from, to);
    return toCsv(
      [
        "Date",
        "Roll number",
        "Barcode",
        "Material code",
        "Material",
        "RT code",
        "Delta code",
        "Consumed (kg)",
        "Left on roll (kg)",
        "Lot type",
        "Challan / invoice no",
        "Used at",
        "Issued to",
        "Note",
      ],
      rows.map((r) => [
        r.date,
        r.roll_number,
        r.barcode,
        r.material_code,
        r.material,
        r.rt_code,
        r.delta_code,
        r.used,
        r.left_on_roll,
        r.lot_type,
        r.document_no,
        r.used_at,
        r.issued_to,
        r.note,
      ]),
    );
  },
};
