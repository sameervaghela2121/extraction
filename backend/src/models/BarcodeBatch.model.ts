import { Schema, model, Types } from "mongoose";

/**
 * A run of blank labels printed before the rolls exist.
 *
 * Only the recipe is stored, not the codes: prefix + date + range regenerate them exactly,
 * so a batch stays a handful of bytes whether it printed 10 labels or 500. Nothing here
 * references a roll — that link is made later, when someone scans the label into the app.
 */
export interface IBarcodeBatch {
  _id: Types.ObjectId;
  /** Letters before the date, e.g. "RT". May be empty. */
  prefix: string;
  /** The day the labels were made for, as YYYY-MM-DD. May be empty (no date in the code). */
  date: string;
  from_number: number;
  to_number: number;
  createdBy: Types.ObjectId;
  /**
   * When the run was removed from the list. Set rather than deleting the row, because the
   * numbers it covers were printed and possibly stuck on rolls — and the next run's start
   * number is worked out from the highest number issued so far. A hard delete rewound that
   * counter and quietly reissued codes that were already in the godown.
   */
  deleted_at?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const barcodeBatchSchema = new Schema<IBarcodeBatch>(
  {
    prefix: { type: String, default: "", trim: true, uppercase: true },
    date: { type: String, default: "", trim: true },
    from_number: { type: Number, required: true, min: 0 },
    to_number: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deleted_at: { type: Date },
  },
  { timestamps: true },
);

// Serves nextNumber(): the highest number issued for a prefix on a date, deleted runs
// included.
barcodeBatchSchema.index({ prefix: 1, date: 1, to_number: -1 });
// The list is always "most recent first" — nothing else reads this collection.
barcodeBatchSchema.index({ createdAt: -1 });
// The same run saved twice means the same barcodes stuck on two different rolls, which is
// unrecoverable once they're in the godown. The index is what actually stops a double
// click; the service turns it into a readable 409.
barcodeBatchSchema.index(
  { prefix: 1, date: 1, from_number: 1, to_number: 1 },
  { unique: true },
);

export const BarcodeBatch = model<IBarcodeBatch>("BarcodeBatch", barcodeBatchSchema);
