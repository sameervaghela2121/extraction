import { Schema, model, Types } from "mongoose";

/**
 * A Goods Receipt Note built from an extracted invoice: just the invoice identity plus
 * what was received. Stored in its own `grns` collection, separate from the extraction
 * data in `Invoice` — the GRN is the user's confirmed count, not the raw reading.
 */
export interface IGrnItem {
  description: string;
  // null (not 0) when the box is left blank — "not counted" and "zero received" differ.
  quantity: number | null;
}

/** "awaiting" = nobody has looked at it yet. Reversible in both directions. */
export type GrnStatus = "awaiting" | "approved" | "rejected";

export interface IGrn {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  fileId: Types.ObjectId;
  invoiceId: Types.ObjectId;
  invoiceNo: string;
  invoiceDate: string;
  items: IGrnItem[];
  // Optional: GRNs saved before this field existed have no `status` key at all — a
  // mongoose `default` doesn't backfill. Read paths coalesce to "awaiting".
  status?: GrnStatus;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  /**
   * Snapshot of the WHOLE extracted invoice as it was read, kept alongside the
   * confirmed values above. The GRN screen shows only a few fields, but everything
   * else (seller, buyer, GSTINs, taxes, totals, other_fields, item rate/hsn/amount)
   * is preserved here so a future requirement is a display change, not a backfill.
   *
   * Reading `extracted.invoice_no` against `invoiceNo` also shows what the user corrected.
   */
  extracted?: Record<string, unknown>;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const grnItemSchema = new Schema<IGrnItem>(
  {
    description: { type: String, default: "" },
    quantity: { type: Number, default: null },
  },
  { _id: false },
);

const grnSchema = new Schema<IGrn>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    fileId: { type: Schema.Types.ObjectId, required: true, index: true },
    // Unique: one GRN per extracted invoice. Saving upserts on this, so a double-tap
    // on Save updates the record instead of creating a duplicate.
    invoiceId: { type: Schema.Types.ObjectId, required: true, unique: true },
    invoiceNo: { type: String, default: "" },
    invoiceDate: { type: String, default: "" },
    items: { type: [grnItemSchema], default: [] },
    status: { type: String, enum: ["awaiting", "approved", "rejected"], default: "awaiting", index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    // Mixed: mirrors how SharedInvoice models Gemini's open-ended output, so fields we
    // don't know about yet survive without a schema change.
    extracted: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

export const Grn = model<IGrn>("Grn", grnSchema);
