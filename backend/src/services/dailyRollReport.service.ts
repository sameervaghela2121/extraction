import { Types } from "mongoose";
import { Location } from "../models/Location.model";
import { Lot } from "../models/Lot.model";
import { MaterialRoll, type IMaterialRoll, type RollStatus } from "../models/MaterialRoll.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { Remark } from "../models/Remark.model";
import { StockTransaction, type IStockTransaction, type TransactionType } from "../models/StockTransaction.model";
import { User } from "../models/User.model";
import { Vendor } from "../models/Vendor.model";

/** The business day is India's, whichever zone the server runs in. */
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_LABEL: Record<RollStatus, string> = {
  IN_STOCK: "In stock",
  ISSUED: "Out",
  CONSUMED: "Consumed",
  RETURNED_TO_VENDOR: "Returned to vendor",
  SOLD: "Sold",
};

const MOVEMENT_LABEL: Record<TransactionType, string> = {
  IN: "Received",
  OUT: "Outward",
  RETURN: "Inward",
  ADJUSTMENT: "Adjusted",
  CONSUME: "Consumed",
  RETURN_TO_VENDOR: "Returned to vendor",
  SELL: "Sold",
};

type Row = IStockTransaction & { roll_id: Types.ObjectId };
type LedgerRow = Pick<
  IStockTransaction,
  "_id" | "transaction_type" | "weight" | "roll_weight_after" | "from_location" | "to_location" | "createdAt"
>;

/** [start, end) of an India-time day, as the instants transaction_date is stored in. A picked
 *  day (midnight UTC, or local midnight from the tablet) falls inside the same day as a full
 *  timestamp does. */
export function istDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function istDate(value: Date): string {
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istDateTime(value: Date): string {
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** The roll's status once this movement had applied, given the one before it — the same
 *  transitions stock.service's applyToRoll makes. The row itself stores no status. */
export function statusAfter(row: Pick<LedgerRow, "transaction_type" | "weight" | "roll_weight_after">, previous?: RollStatus): RollStatus {
  switch (row.transaction_type) {
    case "OUT":
      return "ISSUED";
    case "RETURN":
      return row.roll_weight_after === 0 ? "CONSUMED" : "IN_STOCK";
    case "RETURN_TO_VENDOR":
      return "RETURNED_TO_VENDOR";
    case "SELL":
      return "SOLD";
    case "CONSUME":
      // A CONSUME on a finished roll is a no-op with weight 0; it must not turn a returned or
      // sold roll into a consumed one.
      return row.weight === 0 && previous && previous !== "IN_STOCK" && previous !== "ISSUED"
        ? previous
        : "CONSUMED";
    case "ADJUSTMENT":
      return row.roll_weight_after === 0 ? "CONSUMED" : (previous ?? "IN_STOCK");
    case "IN":
      // Registration, or weight added back: that reopens a finished roll, but a roll that is
      // out stays out.
      return previous === "ISSUED" ? "ISSUED" : "IN_STOCK";
  }
}

/** Whether statusAfter or the location needs the rows around this one, rather than this row
 *  alone. IN and ADJUSTMENT carry no location, and a zero-weight CONSUME keeps the old status. */
function needsLedger(row: Pick<LedgerRow, "transaction_type" | "weight">): boolean {
  return (
    row.transaction_type === "IN" ||
    row.transaction_type === "ADJUSTMENT" ||
    (row.transaction_type === "CONSUME" && row.weight === 0)
  );
}

/**
 * The roll's location once this movement had applied. Null: at no location (finished, or gone
 * from the godown). Rows that state none leave the roll where it was, and the next movement's
 * from_location says where that is; with no next movement, nothing has moved it since, so the
 * roll's own location still holds.
 */
export function locationAfter(
  row: Pick<LedgerRow, "transaction_type" | "roll_weight_after" | "from_location" | "to_location">,
  next: Pick<LedgerRow, "from_location"> | undefined,
  current: Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  const carried = () => (next ? (next.from_location ?? null) : (current ?? null));
  switch (row.transaction_type) {
    case "CONSUME":
    case "RETURN_TO_VENDOR":
    case "SELL":
      return null;
    case "OUT":
      // An OUT that names nowhere leaves the roll where it was.
      return row.to_location ?? row.from_location ?? null;
    case "RETURN":
      return row.roll_weight_after === 0 ? null : (row.to_location ?? row.from_location ?? null);
    case "ADJUSTMENT":
      return row.roll_weight_after === 0 ? null : carried();
    case "IN":
      return carried();
  }
}

/** What the report's rolls had moved on the day: each roll's last row, and how many it had. */
async function lastRowsOn(date: string) {
  const { start, end } = istDayRange(date);
  return StockTransaction.aggregate<{ _id: Types.ObjectId; last: Row; movements: number }>([
    // Served by the transaction_date index. A removed roll's rows carry deleted_at too.
    {
      $match: {
        transaction_date: { $gte: start, $lt: end },
        deleted_at: null,
        roll_id: { $exists: true, $ne: null },
      },
    },
    // Write order, not transaction_date: a picked day has no time of its own, so a day's rows
    // can tie or read out of sequence, while each row's figures were worked out in the order
    // they were written — a device flushes its queue first in, first out.
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: "$roll_id", last: { $last: "$$ROOT" }, movements: { $sum: 1 } } },
  ]).allowDiskUse(true);
}

/** Id -> record for a master, reading only what the report prints. */
async function byId<T extends { _id: Types.ObjectId }>(
  ids: Array<Types.ObjectId | null | undefined>,
  read: (ids: Types.ObjectId[]) => Promise<T[]>,
): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))].map((id) => new Types.ObjectId(id));
  if (unique.length === 0) return new Map();
  return new Map((await read(unique)).map((record) => [record._id.toString(), record]));
}

/** The whole ledger of the rolls that need one, in write order. */
async function ledgersOf(rollIds: Types.ObjectId[]): Promise<Map<string, LedgerRow[]>> {
  const ledgers = new Map<string, LedgerRow[]>();
  if (rollIds.length === 0) return ledgers;
  const rows = await StockTransaction.find({ roll_id: { $in: rollIds }, deleted_at: null })
    .select("roll_id transaction_type weight roll_weight_after from_location to_location createdAt")
    .sort({ createdAt: 1, _id: 1 })
    .lean<Array<LedgerRow & { roll_id: Types.ObjectId }>>();
  for (const row of rows) {
    const key = row.roll_id.toString();
    const list = ledgers.get(key);
    if (list) list.push(row);
    else ledgers.set(key, [row]);
  }
  return ledgers;
}

const joined = (values: Array<string | undefined>) => values.filter(Boolean).join(", ");

/** The report's columns, in the order they print. */
export const REPORT_COLUMNS = [
  "Report date",
  "Roll number",
  "Barcode",
  "Lot type",
  "Challan / invoice no",
  "Vendor code",
  "Vendor",
  "Paper code",
  "RT code",
  "Delta code",
  "Material code",
  "Material",
  "GSM",
  "Width (mm)",
  "Received date",
  "Unit",
  "Weight on arrival",
  "Final weight",
  "Final status",
  "Last movement",
  "Weight moved",
  "Weight used",
  "Last location",
  "Issued to",
  "Remarks",
  "Movement note",
  "Roll note",
  "Movements that day",
  "Last movement recorded at",
  "Recorded by",
] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];
export type ReportRow = Record<ReportColumn, string | number | undefined>;

/** Quotes what CSV needs quoted, and stops a spreadsheet running a typed value as a formula:
 *  remarks and notes are free text from the floor. Numbers pass through as numbers. */
export function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A byte-order mark first, or Excel reads the UTF-8 as its local code page and garbles
 *  Hindi and Gujarati text. */
export function toCsv(rows: ReportRow[]): string {
  const lines = [REPORT_COLUMNS.join(",")];
  for (const row of rows) lines.push(REPORT_COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const dailyRollReportService = {
  /** How many rolls moved on the day — what the screen shows before anyone downloads. */
  async count(date: string): Promise<number> {
    const { start, end } = istDayRange(date);
    const ids = await StockTransaction.distinct("roll_id", {
      transaction_date: { $gte: start, $lt: end },
      deleted_at: null,
      roll_id: { $exists: true, $ne: null },
    });
    return ids.length;
  },

  /**
   * One row per roll that moved on the day, as it stood after its last movement that day.
   *
   * Weight, status, location and the movement's own figures come from the ledger, so a later
   * movement cannot change an earlier day's report. Everything else (identity, lot, paper,
   * vendor, material, picked remarks) comes from the roll as it is now: none of those keep a
   * history to read back.
   */
  async rows(date: string): Promise<ReportRow[]> {
    const moved = await lastRowsOn(date);
    if (moved.length === 0) return [];

    const rolls = await byId(moved.map((m) => m._id), (ids) =>
      MaterialRoll.find({ _id: { $in: ids }, deleted_at: null }).lean<IMaterialRoll[]>(),
    );
    const live = moved.filter((m) => rolls.has(m._id.toString()));
    const ledgers = await ledgersOf(live.filter((m) => needsLedger(m.last)).map((m) => m._id));

    // Each roll's standing after its last row, walking the ledger where the row alone can't say.
    const standing = new Map<string, { status: RollStatus; location: Types.ObjectId | null }>();
    for (const { _id, last } of live) {
      const key = _id.toString();
      const roll = rolls.get(key)!;
      const ledger = ledgers.get(key);
      let status: RollStatus | undefined;
      let next: LedgerRow | undefined;
      if (ledger) {
        const at = ledger.findIndex((row) => row._id.equals(last._id));
        for (const row of ledger.slice(0, at + 1)) status = statusAfter(row, status);
        next = ledger[at + 1];
      }
      standing.set(key, {
        status: status ?? statusAfter(last),
        location: locationAfter(last, next, roll.location),
      });
    }

    const liveRolls = [...rolls.values()];
    const [vendors, materials, lots, locations, users, remarks] = await Promise.all([
      byId(liveRolls.map((r) => r.vendor_id), (ids) =>
        Vendor.find({ _id: { $in: ids } }).select("name vendor_code").lean<Array<{ _id: Types.ObjectId; name: string; vendor_code: string }>>(),
      ),
      byId(liveRolls.map((r) => r.material_id), (ids) =>
        RawMaterial.find({ _id: { $in: ids } }).select("name material_code").lean<Array<{ _id: Types.ObjectId; name: string; material_code: string }>>(),
      ),
      byId(liveRolls.map((r) => r.lot_id), (ids) =>
        Lot.find({ _id: { $in: ids } }).select("document_type document_no").lean<Array<{ _id: Types.ObjectId; document_type: string; document_no: string }>>(),
      ),
      byId([...standing.values()].map((s) => s.location), (ids) =>
        Location.find({ _id: { $in: ids } }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>(),
      ),
      byId(live.map((m) => m.last.created_by), (ids) =>
        User.find({ _id: { $in: ids } }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>(),
      ),
      Remark.find({
        $or: [
          { _id: { $in: liveRolls.flatMap((r) => r.remark_codes ?? []) } },
          {
            remark_code: {
              $in: [
                ...liveRolls.map((r) => r.remark_code),
                ...live.map((m) => m.last.remark_code),
              ].filter(Boolean),
            },
          },
        ],
      })
        .select("remark_code label")
        .lean<Array<{ _id: Types.ObjectId; remark_code: string; label: string }>>(),
    ]);
    const remarkById = new Map(remarks.map((r) => [r._id.toString(), r.label]));
    const remarkByCode = new Map(remarks.map((r) => [r.remark_code, r.label]));

    const rows = live.map(({ _id, last, movements }): ReportRow => {
      const key = _id.toString();
      const roll = rolls.get(key)!;
      const { status, location } = standing.get(key)!;
      const vendor = vendors.get(String(roll.vendor_id));
      const material = materials.get(String(roll.material_id));
      const lot = roll.lot_id ? lots.get(String(roll.lot_id)) : undefined;
      const papers = roll.papers ?? [];
      // Picked on the roll, noted when it arrived, or picked on this movement — one remark
      // picked in two of those places reads once. A code no longer in the master prints as is.
      const remarkLabels = new Set(
        [
          ...(roll.remark_codes ?? []).map((id) => remarkById.get(id.toString())),
          roll.remark_code ? (remarkByCode.get(roll.remark_code) ?? roll.remark_code) : undefined,
          last.remark_code ? (remarkByCode.get(last.remark_code) ?? last.remark_code) : undefined,
        ].filter((label): label is string => Boolean(label)),
      );
      // The server's own line on a registration row says nothing the columns don't.
      const note = last.transaction_type === "IN" && /^Roll .* received$/.test(last.remarks ?? "") ? undefined : last.remarks;
      return {
        "Report date": date,
        "Roll number": roll.roll_number,
        Barcode: roll.barcode,
        "Lot type": lot ? (lot.document_type === "invoice" ? "Invoice" : "Challan") : undefined,
        "Challan / invoice no": lot?.document_no,
        "Vendor code": vendor?.vendor_code,
        Vendor: vendor?.name,
        "Paper code": joined(papers.map((p) => p.supplier_code_number)),
        "RT code": joined(papers.map((p) => p.royal_touche_code)),
        "Delta code": joined(papers.map((p) => p.delta_code)),
        "Material code": material?.material_code,
        Material: material?.name,
        GSM: roll.gsm,
        "Width (mm)": roll.width,
        "Received date": istDate(roll.date),
        Unit: roll.unit,
        "Weight on arrival": roll.weight,
        "Final weight": last.roll_weight_after,
        "Final status": STATUS_LABEL[status],
        "Last movement": MOVEMENT_LABEL[last.transaction_type],
        "Weight moved": last.weight,
        "Weight used": last.used_weight,
        "Last location": location ? locations.get(location.toString())?.name : undefined,
        "Issued to": last.issued_to,
        Remarks: [...remarkLabels].join(", "),
        "Movement note": note,
        "Roll note": roll.remarks,
        "Movements that day": movements,
        "Last movement recorded at": istDateTime(last.createdAt),
        "Recorded by": users.get(String(last.created_by))?.name,
      };
    });
    // Mill numbers like "DP24" and "R9863": "DP9" belongs before "DP24".
    return rows.sort((a, b) =>
      String(a["Roll number"]).localeCompare(String(b["Roll number"]), "en", { numeric: true }),
    );
  },

  async csv(date: string): Promise<string> {
    return toCsv(await this.rows(date));
  },
};
