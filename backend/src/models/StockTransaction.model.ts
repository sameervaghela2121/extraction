import { Schema, model, Types } from "mongoose";

/**
 * IN         - stock arriving: a roll being received (written automatically on create).
 * OUT        - a whole roll leaving the store for a location. Nothing is consumed yet,
 *              so no weight changes; the roll is simply somewhere else.
 * RETURN     - that roll coming back. This is where consumption is recorded: the
 *              operator states what was used and the roll's weight drops by it.
 * ADJUSTMENT - a correction from a physical count.
 */
export const TRANSACTION_TYPES = ["IN", "OUT", "RETURN", "ADJUSTMENT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface IStockTransaction {
  _id: Types.ObjectId;
  transaction_type: TransactionType;
  transaction_date: Date;
  material_id: Types.ObjectId;
  roll_id?: Types.ObjectId;
  vendor_id?: Types.ObjectId;
  /** Weight this movement took out of, or brought into, the store — always positive,
   *  the direction is the type. An OUT carries the whole roll, a RETURN carries back
   *  whatever is left on it. */
  weight: number;
  /** RETURN only: how much the line actually used while the roll was out. Stored rather
   *  than derived so usage reports do not have to pair every RETURN with its OUT. */
  used_weight?: number;
  /** The material's total on-hand weight after this movement — the stock screen's
   *  number, not the roll screen's. */
  material_weight_after: number;
  /** What this roll itself weighed after this movement. This is what a roll's history
   *  shows: 247 -> 247 (out, nothing used) -> 47 (back, 200 used). */
  roll_weight_after?: number;
  issued_to?: string;
  /** Where the roll was before this movement, and where it is after. Both set on
   *  OUT/RETURN so the ledger reads as a journey and the return can put the roll back
   *  exactly where it came from. */
  from_location?: string;
  to_location?: string;
  remarks?: string;
  created_by: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const stockTransactionSchema = new Schema<IStockTransaction>(
  {
    transaction_type: { type: String, enum: [...TRANSACTION_TYPES], required: true, index: true },
    // When the movement physically happened — not when the row was written.
    transaction_date: { type: Date, required: true, index: true },
    material_id: { type: Schema.Types.ObjectId, ref: "RawMaterial", required: true, index: true },
    // Absent for movements that aren't roll-level (a bulk adjustment, loose stock).
    roll_id: { type: Schema.Types.ObjectId, ref: "MaterialRoll", index: true },
    // Only meaningful on IN.
    vendor_id: { type: Schema.Types.ObjectId, ref: "Vendor" },
    // Always positive. The direction lives in transaction_type, so a signed weight
    // would let the same movement be expressed two ways.
    weight: { type: Number, required: true, min: 0 },
    used_weight: { type: Number, min: 0 },
    // Both running figures are stored, so neither history has to be replayed to read it.
    material_weight_after: { type: Number, required: true },
    roll_weight_after: { type: Number, min: 0 },
    // Free text: who took it. No employee master exists yet.
    issued_to: { type: String, trim: true },
    from_location: { type: String, trim: true },
    to_location: { type: String, trim: true },
    remarks: { type: String, trim: true },
    created_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "stock_transactions" },
);

export const StockTransaction = model<IStockTransaction>(
  "StockTransaction",
  stockTransactionSchema,
);
