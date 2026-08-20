import { Schema, model, Types } from "mongoose";

/**
 * One row per material: the current on-hand totals. A cache of what
 * stock_transactions already implies, kept so stock screens don't aggregate the
 * whole movement history on every read.
 */
export interface IStockSummary {
  _id: Types.ObjectId;
  material_id: Types.ObjectId;
  /** On-hand weight across the material's rolls. */
  total_weight: number;
  total_rolls: number;
  last_updated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stockSummarySchema = new Schema<IStockSummary>(
  {
    // Unique: one summary row per material, or the cache has no meaning.
    material_id: {
      type: Schema.Types.ObjectId,
      ref: "RawMaterial",
      required: true,
      unique: true,
    },
    total_weight: { type: Number, required: true, default: 0, min: 0 },
    total_rolls: { type: Number, required: true, default: 0, min: 0 },
    // When the totals were last recomputed. Distinct from updatedAt, which also moves
    // on writes that don't change the numbers.
    last_updated: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: "stock_summary" },
);

export const StockSummary = model<IStockSummary>("StockSummary", stockSummarySchema);
