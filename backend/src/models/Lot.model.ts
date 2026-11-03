import { Schema, model, Types } from "mongoose";

/** The paper a delivery comes with — the operator picks which one they photographed. */
export const LOT_DOCUMENT_TYPES = ["challan", "invoice"] as const;
export type LotDocumentType = (typeof LOT_DOCUMENT_TYPES)[number];

/**
 * One delivery of raw material — the rolls that arrived together from one supplier, on one
 * document: a delivery challan or an invoice, whichever came with the goods. Rolls point at
 * it (MaterialRoll.lot_id) so a roll can be traced to the delivery and document it came on.
 *
 * A lot is known by its document — type and number — so a lot made offline on the tablet
 * reads the same before and after it syncs; nothing about it is minted by the server.
 */
export interface ILot {
  _id: Types.ObjectId;
  /** Whether document_no is a challan's or an invoice's number. */
  document_type: LotDocumentType;
  /** The challan or invoice number, as written on it. Not unique: two suppliers can use the
   *  same number, so the app warns about a repeat rather than the server refusing. */
  document_no: string;
  /** GCS object path of the document photo, under lots/ — a path, not a URL, like roll photos. */
  document_photo_path?: string;
  /** Minted on the device, so a retried sync returns this lot instead of creating another. */
  client_id?: string;
  created_by: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const lotSchema = new Schema<ILot>(
  {
    document_type: { type: String, enum: LOT_DOCUMENT_TYPES, required: true },
    document_no: { type: String, required: true, trim: true },
    document_photo_path: { type: String, trim: true },
    client_id: { type: String, trim: true },
    created_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "lots" },
);

// Finding a challan's or invoice's lot by its number.
lotSchema.index({ document_no: 1 });
// The replay guard — sparse, like the roll's: lots made on the server directly carry none.
lotSchema.index({ client_id: 1 }, { unique: true, sparse: true });
// The device's delta pull, walked by (updatedAt, _id) like rolls.
lotSchema.index({ updatedAt: 1, _id: 1 });

export const Lot = model<ILot>("Lot", lotSchema);
