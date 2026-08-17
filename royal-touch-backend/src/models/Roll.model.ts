import { Schema, model, Types } from "mongoose";

/** Where the roll is right now. Its history lives in RollIssue, never here. */
export type RollStatus = "IN_STOCK" | "ISSUED" | "CONSUMED";

/**
 * One physical roll. Identified permanently by `barcodeId` — the sticker we print and
 * attach on receipt.
 *
 * Everything the supplier printed is kept as *reference* data, never identity: their roll
 * numbers share no format across suppliers (D00 8004018, 9001528187, TGDD20050A,
 * 2-00196-16) and nothing guarantees they don't collide between them.
 *
 * Three supplier weights are stored because the labels disagree about which exists:
 * Schattdecor prints gross = net, Magnete prints both and they differ, ITC prints
 * chargeable and gross but no net, LamiGraf prints one number. `receivedWeightKg` is the
 * single canonical figure the business counts; `currentWeightKg` is what is left today.
 */
export interface IRoll {
  _id: Types.ObjectId;
  barcodeId: string;
  materialId: Types.ObjectId;
  supplierId: Types.ObjectId;

  supplierRollNo?: string;
  supplierOrderNo?: string;
  supplierReferenceNo?: string;
  soNumber?: string;
  ceNumber?: string;
  supplierBarcodeValue?: string;

  receivedWeightKg: number;
  currentWeightKg: number;
  grossWeightKg?: number;
  netWeightKg?: number;
  chargeableWeightKg?: number;

  lengthM?: number;
  diameterMm?: number;
  splices?: number;
  areaM2?: number;

  productionDate?: Date;
  packingDate?: Date;
  receivedDate: Date;

  batchId?: Types.ObjectId;
  locationId?: Types.ObjectId;

  status: RollStatus;
  currentIssueId?: Types.ObjectId;

  tagPhotoPath?: string;
  stitchedBarcodePhotoPath?: string;
  side1PhotoPath?: string;
  side2PhotoPath?: string;
  ocrRawText?: string;

  registeredBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const rollSchema = new Schema<IRoll>(
  {
    barcodeId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    materialId: { type: Schema.Types.ObjectId, ref: "Material", required: true, index: true },
    // Denormalised from the material so the duplicate-receipt index below can exist.
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },

    supplierRollNo: { type: String, trim: true },
    supplierOrderNo: { type: String, trim: true },
    supplierReferenceNo: { type: String, trim: true },
    soNumber: { type: String, trim: true },
    ceNumber: { type: String, trim: true },
    // Read straight off the label's own barcode/QR when the app scans it instead of
    // OCR-ing the text — exact rather than guessed.
    supplierBarcodeValue: { type: String, trim: true },

    receivedWeightKg: { type: Number, required: true, min: 0 },
    currentWeightKg: { type: Number, required: true, min: 0 },
    grossWeightKg: { type: Number, min: 0 },
    netWeightKg: { type: Number, min: 0 },
    chargeableWeightKg: { type: Number, min: 0 },

    lengthM: { type: Number, min: 0 },
    diameterMm: { type: Number, min: 0 },
    splices: { type: Number, min: 0 },
    areaM2: { type: Number, min: 0 },

    productionDate: { type: Date },
    packingDate: { type: Date },
    receivedDate: { type: Date, required: true, default: Date.now },

    // Optional refs, not required: a roll that arrives at 6am must be registerable before
    // anyone has created a master row for its consignment or its rack.
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", index: true },
    locationId: { type: Schema.Types.ObjectId, ref: "Location", index: true },

    status: {
      type: String,
      enum: ["IN_STOCK", "ISSUED", "CONSUMED"],
      default: "IN_STOCK",
      index: true,
    },
    currentIssueId: { type: Schema.Types.ObjectId, ref: "RollIssue" },

    // Object paths in GCS, never URLs: a signed URL expires, so one stored here would
    // rot into a dead link. Read URLs are minted per response instead.
    tagPhotoPath: { type: String, trim: true },
    stitchedBarcodePhotoPath: { type: String, trim: true },
    side1PhotoPath: { type: String, trim: true },
    side2PhotoPath: { type: String, trim: true },
    // Kept verbatim for audit and for improving the parser — never read by business logic.
    ocrRawText: { type: String },

    registeredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// Catches the same physical roll being received twice: sparse, because most rolls arrive
// without a scannable supplier code and repeated nulls must not collide.
rollSchema.index(
  { supplierId: 1, supplierBarcodeValue: 1 },
  { unique: true, partialFilterExpression: { supplierBarcodeValue: { $type: "string" } } },
);

export const Roll = model<IRoll>("Roll", rollSchema);
