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
  /** Royal Touche's code for the base paper, off the label. Shared by every roll of it.
   *  Optional for now — see createRollSchema. */
  royal_touche_code?: string;
  material_id: Types.ObjectId;
  vendor_id: Types.ObjectId;
  batch_no?: string;
  /** Weight as received — the stock figure: what gets consumed, summed and reported. */
  weight: number;
  remaining_weight?: number;
  /** Length/pieces as printed on the label. Reference only — never consumed, never
   *  summed. Kept so the label can be reproduced and cross-checked. */
  quantity?: number;
  unit: string;
  gsm: number;
  /** Millimetres. */
  width: number;
  location: string;
  /** GCS object paths, not URLs: a stored URL expires, a path does not. Read URLs are
   *  signed per response. Four captures from the registration flow, all optional. */
  tag_photo_path?: string;
  stitched_barcode_photo_path?: string;
  side1_photo_path?: string;
  side2_photo_path?: string;
  /** The date the roll was received. */
  date: Date;
  status: RollStatus;
  /** Minted on the device when the roll was registered, so a flush that retries after a
   *  lost response gets this roll back instead of registering a second one. Absent on
   *  rolls created from the web portal, which never queues. */
  client_id?: string;
  createdAt: Date;
  updatedAt: Date;
}

const materialRollSchema = new Schema<IMaterialRoll>(
  {
    // The barcode value printed on the roll. String, not ObjectId — it comes from
    // the label, not from us.
    roll_number: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // Royal Touche's own code for the base paper this roll is made of — read off the
    // label, like roll_number. NOT unique: it identifies the paper, not the roll, so
    // every roll of paper 639 carries 639. Indexed because "show me all rolls of this
    // paper" is the question it exists to answer.
    //
    // Not required for now, at the client's request. Sparse is deliberate: without it the
    // index would carry an entry for every roll that has no code.
    royal_touche_code: { type: String, uppercase: true, trim: true, index: true, sparse: true },
    material_id: { type: Schema.Types.ObjectId, ref: "RawMaterial", required: true, index: true },
    vendor_id: { type: Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    batch_no: { type: String, trim: true },
    weight: { type: Number, min: 0, required: true },
    // Copied from weight on receipt, then drawn down as the roll is consumed.
    remaining_weight: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
    // Snapshot of the material's unit/gsm/width at receipt time — the master record can
    // change later, but what physically arrived on this roll cannot.
    // Unit of the weight (kg, lb). Not of `quantity`.
    unit: { type: String, trim: true, default: "kg" },
    gsm: { type: Number, min: 0, required: true },
    width: { type: Number, min: 0, required: true },
    location: { type: String, trim: true, required: true },
    tag_photo_path: { type: String, trim: true },
    stitched_barcode_photo_path: { type: String, trim: true },
    side1_photo_path: { type: String, trim: true },
    side2_photo_path: { type: String, trim: true },
    date: { type: Date, required: true },
    status: { type: String, enum: [...ROLL_STATUSES], default: "IN_STOCK", index: true },
    client_id: { type: String, trim: true },
  },
  { timestamps: true, collection: "materials_rolls" },
);

// Serves refreshSummary's aggregation, which runs on every roll create and every stock
// movement: { material_id, status: "IN_STOCK", remaining_weight: { $gt: 0 } }. The single
// -field material_id index above makes Mongo fetch every roll of that material and filter
// in memory; this one answers the match from the index alone. Field order follows the
// query — equality, equality, then range.
materialRollSchema.index({ material_id: 1, status: 1, remaining_weight: 1 });

// The replay guard. Sparse is not optional: every roll registered before this field
// existed has no client_id, and a plain unique index would read them all as the same
// null and refuse to build. Sparse leaves them out of the index altogether.
materialRollSchema.index({ client_id: 1 }, { unique: true, sparse: true });

// Serves the delta pull: `updated_after=<checkpoint>` sorted ascending, which is how a
// device catches up on everything that changed while it was offline.
materialRollSchema.index({ updatedAt: 1 });

export const MaterialRoll = model<IMaterialRoll>("MaterialRoll", materialRollSchema);
