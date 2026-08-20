import { Schema, model, Types } from "mongoose";

/**
 * IN_STOCK = still has weight on it, however much has been drawn off.
 * CONSUMED = emptied; nothing left to issue.
 * ISSUED   = the whole roll left the store as a unit. Nothing sets this today — a normal
 *            issue draws quantity off the roll and it stays IN_STOCK until it hits zero.
 *            Kept so older rows and a future whole-roll handover still have a value.
 */
export const ROLL_STATUSES = ["IN_STOCK", "ISSUED", "CONSUMED"] as const;
export type RollStatus = (typeof ROLL_STATUSES)[number];

export interface IMaterialRoll {
  _id: Types.ObjectId;
  roll_number: string;
  material_id: Types.ObjectId;
  vendor_id?: Types.ObjectId;
  batch_no?: string;
  /** Weight is the stock figure: it is what gets consumed, summed and reported.
   *  Optional because a roll can be registered before it has been weighed. */
  initial_weight?: number;
  remaining_weight?: number;
  /** Length/pieces as printed on the label. Reference only — never consumed, never
   *  summed. Kept so the label can be reproduced and cross-checked. */
  quantity?: number;
  unit: string;
  gsm?: number;
  width_mm?: number;
  location?: string;
  /** GCS object paths, not URLs: a stored URL expires, a path does not. Read URLs are
   *  signed per response. Four captures from the registration flow, all optional. */
  tag_photo_path?: string;
  stitched_barcode_photo_path?: string;
  side1_photo_path?: string;
  side2_photo_path?: string;
  received_date: Date;
  status: RollStatus;
  createdAt: Date;
  updatedAt: Date;
}

const materialRollSchema = new Schema<IMaterialRoll>(
  {
    // The barcode value printed on the roll. String, not ObjectId — it comes from
    // the label, not from us.
    roll_number: { type: String, required: true, unique: true, uppercase: true, trim: true },
    material_id: { type: Schema.Types.ObjectId, ref: "RawMaterial", required: true, index: true },
    // Optional: rolls found in stock without a known source still need to be recorded.
    vendor_id: { type: Schema.Types.ObjectId, ref: "Vendor", index: true },
    batch_no: { type: String, trim: true },
    initial_weight: { type: Number, min: 0 },
    // Copied from initial_weight on receipt, then drawn down as the roll is consumed.
    remaining_weight: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
    // Snapshot of the material's unit/gsm/width at receipt time — the master record can
    // change later, but what physically arrived on this roll cannot.
    // Unit of the weight (kg, lb). Not of `quantity`.
    unit: { type: String, trim: true, default: "kg" },
    gsm: { type: Number, min: 0 },
    width_mm: { type: Number, min: 0 },
    location: { type: String, trim: true },
    tag_photo_path: { type: String, trim: true },
    stitched_barcode_photo_path: { type: String, trim: true },
    side1_photo_path: { type: String, trim: true },
    side2_photo_path: { type: String, trim: true },
    received_date: { type: Date, required: true },
    status: { type: String, enum: [...ROLL_STATUSES], default: "IN_STOCK", index: true },
  },
  { timestamps: true, collection: "materials_rolls" },
);

export const MaterialRoll = model<IMaterialRoll>("MaterialRoll", materialRollSchema);
