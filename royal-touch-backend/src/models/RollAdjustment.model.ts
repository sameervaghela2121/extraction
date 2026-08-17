import { Schema, model, Types } from "mongoose";

/**
 * A weight correction made while the roll is in stock — a mis-keyed figure at registration,
 * a re-weigh on a better scale, damage written off.
 *
 * Exists so that every kilogram is still accounted for. Without it, editing currentWeightKg
 * would silently break the reconciliation that makes this system worth having:
 *
 *   receivedWeightKg - currentWeightKg = sum(RollIssue.consumedKg) + sum(RollAdjustment.deltaKg)
 *
 * `reason` is required for the same purpose. An adjustment nobody can explain later is
 * indistinguishable from stock going missing.
 */
export interface IRollAdjustment {
  _id: Types.ObjectId;
  rollId: Types.ObjectId;
  previousWeightKg: number;
  newWeightKg: number;
  /** Negative when the roll lost weight — the common direction. */
  deltaKg: number;
  reason: string;
  adjustedBy: Types.ObjectId;
  adjustedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const rollAdjustmentSchema = new Schema<IRollAdjustment>(
  {
    rollId: { type: Schema.Types.ObjectId, ref: "Roll", required: true, index: true },
    previousWeightKg: { type: Number, required: true, min: 0 },
    newWeightKg: { type: Number, required: true, min: 0 },
    deltaKg: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    adjustedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    adjustedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

export const RollAdjustment = model<IRollAdjustment>("RollAdjustment", rollAdjustmentSchema);
