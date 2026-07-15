import { Schema, model, Types } from "mongoose";
import { env } from "../config/env";

/**
 * Maps onto the `Invoice` collection already written by invoice-generator-backend
 * (raw pymongo, one doc per extracted invoice) — strict:false so its full Gemini-output
 * shape (plus any `other_fields` keys and our own edit stamps) survives round-trips.
 */
export interface ISharedInvoice {
  _id: Types.ObjectId;
  job_id: string;
  file_id: Types.ObjectId;
  page?: number;
  invoice_no?: string;
  invoice_date?: string;
  seller_name?: string;
  seller_gstin?: string;
  buyer_name?: string;
  buyer_gstin?: string;
  // Mixed on purpose: different PDFs extract different item shapes (columns vary by
  // invoice layout), so this isn't a fixed interface — callers derive columns from
  // whatever keys are actually present instead of assuming description/hsn/qty/etc.
  items?: Array<Record<string, unknown>>;
  taxable_value?: number;
  cgst_rate?: string;
  cgst_amount?: number;
  sgst_rate?: string;
  sgst_amount?: number;
  igst_rate?: string;
  igst_amount?: number;
  round_off?: number;
  grand_total?: number;
  grand_total_words?: string;
  other_fields?: Record<string, string>;
  validation?: string;
  error?: string;
  created_at: Date;
  editedBy?: Types.ObjectId;
  editedAt?: Date;
}

const sharedInvoiceSchema = new Schema<ISharedInvoice>(
  {
    job_id: { type: String, index: true },
    file_id: { type: Schema.Types.ObjectId, index: true },
    page: { type: Number },
    invoice_no: { type: String },
    invoice_date: { type: String },
    seller_name: { type: String },
    seller_gstin: { type: String },
    buyer_name: { type: String },
    buyer_gstin: { type: String },
    items: { type: [Schema.Types.Mixed] },
    taxable_value: { type: Number },
    cgst_rate: { type: String },
    cgst_amount: { type: Number },
    sgst_rate: { type: String },
    sgst_amount: { type: Number },
    igst_rate: { type: String },
    igst_amount: { type: Number },
    round_off: { type: Number },
    grand_total: { type: Number },
    grand_total_words: { type: String },
    other_fields: { type: Schema.Types.Mixed },
    validation: { type: String },
    error: { type: String },
    created_at: { type: Date },
    editedBy: { type: Schema.Types.ObjectId, ref: "User" },
    editedAt: { type: Date },
  },
  { strict: false, versionKey: false, collection: env.invoiceCollection },
);

export const SharedInvoice = model<ISharedInvoice>("SharedInvoice", sharedInvoiceSchema);
