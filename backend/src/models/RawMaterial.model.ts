import { Schema, model, Types } from "mongoose";

export const RAW_MATERIAL_STATUSES = ["active", "inactive"] as const;
export type RawMaterialStatus = (typeof RAW_MATERIAL_STATUSES)[number];

export interface IRawMaterial {
  _id: Types.ObjectId;
  material_code: string;
  name: string;
  category?: string;
  gsm?: number;
  width_mm?: number;
  unit: string;
  reorder_level?: number;
  /** Where this material sits in a picker, low first. Same idea as a location's: the list
   *  should follow how the godown actually thinks about its materials, which is rarely
   *  alphabetical. Absent sorts last, so an unnumbered material never jumps to the top. */
  sort_order?: number;
  status: RawMaterialStatus;
  createdAt: Date;
  updatedAt: Date;
}

const rawMaterialSchema = new Schema<IRawMaterial>(
  {
    // Short stable handle. Renaming a material must not break what referenced it.
    material_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    // Optional because not every material is a fabric — gsm/width only apply to rolls.
    gsm: { type: Number, min: 0 },
    width_mm: { type: Number, min: 0 },
    unit: { type: String, required: true, trim: true },
    // Stock threshold that should trigger a reorder. Absent = nobody tracks it yet.
    reorder_level: { type: Number, min: 0 },
    sort_order: { type: Number },
    status: { type: String, enum: [...RAW_MATERIAL_STATUSES], default: "active" },
  },
  { timestamps: true, collection: "raw_materials" },
);

export const RawMaterial = model<IRawMaterial>("RawMaterial", rawMaterialSchema);
