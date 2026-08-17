import { Schema, model, Types } from "mongoose";

/**
 * Who printed the label. Kept as its own collection rather than a string on the material
 * because every downstream rule is supplier-specific: which fields their label carries,
 * what units they print, and how their roll numbers are shaped.
 */
export interface ISupplier {
  _id: Types.ObjectId;
  code: string;
  name: string;
  country?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<ISupplier>(
  {
    // Short stable handle used inside materialKey — renaming the supplier must not
    // silently re-key every material under it.
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Supplier = model<ISupplier>("Supplier", supplierSchema);
