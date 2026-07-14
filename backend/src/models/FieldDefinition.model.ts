import { Schema, model, Types } from "mongoose";

export interface IFieldDefinition {
  _id: Types.ObjectId;
  key: string;
  label: string;
  description?: string;
  required: boolean;
  enabled: boolean;
  isCustom: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const fieldDefinitionSchema = new Schema<IFieldDefinition>(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    description: { type: String },
    required: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    isCustom: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const FieldDefinition = model<IFieldDefinition>("FieldDefinition", fieldDefinitionSchema);

/** Seed defaults mirroring invoice-generator-backend's Gemini extraction output shape. */
export const DEFAULT_INVOICE_FIELD_DEFINITIONS: Array<
  Pick<IFieldDefinition, "key" | "label" | "required" | "enabled" | "isCustom" | "order">
> = [
  { key: "invoice_no", label: "Invoice number", required: true, enabled: true, isCustom: false, order: 0 },
  { key: "invoice_date", label: "Invoice date", required: true, enabled: true, isCustom: false, order: 1 },
  { key: "seller_name", label: "Seller name", required: true, enabled: true, isCustom: false, order: 2 },
  { key: "seller_gstin", label: "Seller GSTIN", required: false, enabled: true, isCustom: false, order: 3 },
  { key: "buyer_name", label: "Buyer name", required: false, enabled: true, isCustom: false, order: 4 },
  { key: "buyer_gstin", label: "Buyer GSTIN", required: false, enabled: true, isCustom: false, order: 5 },
  { key: "taxable_value", label: "Taxable value", required: true, enabled: true, isCustom: false, order: 6 },
  { key: "cgst_amount", label: "CGST amount", required: false, enabled: true, isCustom: false, order: 7 },
  { key: "sgst_amount", label: "SGST amount", required: false, enabled: true, isCustom: false, order: 8 },
  { key: "igst_amount", label: "IGST amount", required: false, enabled: true, isCustom: false, order: 9 },
  { key: "round_off", label: "Round off", required: false, enabled: false, isCustom: false, order: 10 },
  { key: "grand_total", label: "Grand total", required: true, enabled: true, isCustom: false, order: 11 },
];
