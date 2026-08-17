import { Schema, model, Types } from "mongoose";
import { buildMaterialKey } from "../utils/materialKey";

/**
 * A material *specification*, not a physical roll: "Schattdecor Lamella, 1250mm, 70gsm".
 * The same design at a different width is a different material.
 *
 * Everything measured here is normalised — widthMm in millimetres, gsm in g/m² — because
 * suppliers print cm, mm, "BASIS WT GSM", "GRAMMAGE" and "G/M2" interchangeably. The OCR
 * layer converts; nothing downstream should ever have to ask which unit a number is in.
 */
export interface IMaterial {
  _id: Types.ObjectId;
  materialKey: string;
  supplierId: Types.ObjectId;
  supplierCode: string;
  name: string;
  sku: string;
  designCode?: string;
  supplierMaterialCode?: string;
  widthMm: number;
  gsm: number;
  coreMm?: number;
  countryOfOrigin?: string;
  thumbnailUrl?: string;
  /** Expected values for a full roll — prefill for the registration form, never stock. */
  nominalWeightKg?: number;
  nominalLengthM?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const materialSchema = new Schema<IMaterial>(
  {
    materialKey: { type: String, required: true, unique: true },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    // Denormalised so materialKey can be rebuilt, and lists rendered, without a join.
    supplierCode: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // Absent on ITC base paper, which the label identifies by gsm and width alone.
    designCode: { type: String, trim: true },
    supplierMaterialCode: { type: String, trim: true },
    widthMm: { type: Number, required: true },
    gsm: { type: Number, required: true },
    coreMm: { type: Number },
    countryOfOrigin: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
    nominalWeightKg: { type: Number },
    nominalLengthM: { type: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Derived, never client-supplied: a caller cannot set a key that disagrees with the
// fields it claims to summarise.
materialSchema.pre("validate", function (next) {
  this.materialKey = buildMaterialKey({
    supplierCode: this.supplierCode,
    designCode: this.designCode,
    widthMm: this.widthMm,
    gsm: this.gsm,
  });
  next();
});

// Backs the ?search= query on the Select Material screen.
materialSchema.index({ name: 1 });

export const Material = model<IMaterial>("Material", materialSchema);
