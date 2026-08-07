import { Schema, model, Types } from "mongoose";
import type { DocumentSource, DocumentWorkflowStatus } from "./Document.model";

/**
 * The intake/workflow record for the General Vouchers module — structurally the same as
 * Document.model.ts, but its own collection rather than a `purpose` flag on `documents`.
 * Unlike GRN, a General Voucher has no separate "confirmed capture" step (no goods-received
 * quantities to compare) — this row plus the shared Files/Invoice extraction is the whole
 * record, the same relationship Documents has to Files/Invoice.
 */
export interface IGeneralVoucher {
  _id: Types.ObjectId;
  fileId: Types.ObjectId;
  jobId: string;
  title: string;
  status: DocumentWorkflowStatus;
  source: DocumentSource;
  ownerId: Types.ObjectId;
  uploadedAt: Date;
  verifiedAt?: Date;
  verifiedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const generalVoucherSchema = new Schema<IGeneralVoucher>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true, index: true },
    jobId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    status: { type: String, enum: ["pending", "verified", "archived"], default: "pending", index: true },
    source: { type: String, enum: ["upload", "scan", "email"], required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    uploadedAt: { type: Date, default: () => new Date() },
    verifiedAt: { type: Date },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "general_vouchers" },
);

export const GeneralVoucher = model<IGeneralVoucher>("GeneralVoucher", generalVoucherSchema);
