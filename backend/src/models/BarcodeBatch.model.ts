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
  /**
   * How this run was printed: a barcode symbol or a QR code.
   *
   * Fixed at creation and never re-derived from a UI setting — an operator who later
   * switches their printer's default to the other kind must not change what an *old* run
   * regenerates as, since its physical labels are already stuck on rolls in whatever kind
   * they were actually printed in. Records saved before this field existed have none in
   * the database; the service defaults those to "barcode", the only kind that existed then.
   */
  kind: "barcode" | "qr";
  /**
   * The physical sticker size this run was printed at, in millimetres.
   *
   * Fixed at creation for the same reason `kind` is: the sticker size picker on the
   * generator screen is a setting of "whatever's loaded in the printer right now," not a
   * fact about any particular run. Without this, reprinting an old run used whatever size
   * happened to be selected at that later moment — silently stretching a 70x30mm run's
   * barcode onto a 100x50mm page, or worse, squeezing a QR meant to fill a square label
   * into a thin corner of a wide one. Records saved before this field existed default to
   * 100x50mm for barcode runs (the app's original, size wasn't configurable then) and
   * 40x40mm for QR runs (the QR feature's own default) — a best-effort guess, since their
   * true original size was never recorded.
   */
  widthMm: number;
  heightMm: number;
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
    kind: { type: String, enum: ["barcode", "qr"], default: "barcode" },
    widthMm: { type: Number, default: 100, min: 1 },
    heightMm: { type: Number, default: 50, min: 1 },
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
