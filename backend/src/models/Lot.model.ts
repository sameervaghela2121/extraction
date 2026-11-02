import { Schema, model, Types } from "mongoose";

/**
 * One delivery of raw material — the rolls that arrived together from one supplier, on one
 * document: a delivery challan or an invoice, whichever came with the goods. Rolls point at
 * it (MaterialRoll.lot_id) so a roll can be traced to the delivery and document it came on.
 *
 * Created on the device like a roll — offline first, queued, synced — so the number the
 * operator reads ("Lot-12") is minted here on arrival, never on the device: two devices
 * working offline would otherwise hand out the same number.
 */
/** The paper a delivery comes with — the operator picks which one they photographed. */
export const LOT_DOCUMENT_TYPES = ["challan", "invoice"] as const;
export type LotDocumentType = (typeof LOT_DOCUMENT_TYPES)[number];

export interface ILot {
  _id: Types.ObjectId;
  /** "Lot-1", "Lot-2" … — the human-facing number, from lot_seq. */
  lot_number: string;
  /** The counter value behind lot_number, kept as a number so lots sort and never collide. */
  lot_seq: number;
  /** Whether document_no is a challan's or an invoice's number. */
  document_type: LotDocumentType;
  /** The challan or invoice number, as written on it. Not unique: the app warns about a
   *  repeat rather than the server refusing. */
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
    lot_number: { type: String, required: true, trim: true },
    lot_seq: { type: Number, required: true },
    document_type: { type: String, enum: LOT_DOCUMENT_TYPES, required: true },
    document_no: { type: String, required: true, trim: true },
    document_photo_path: { type: String, trim: true },
    client_id: { type: String, trim: true },
    created_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "lots" },
);

lotSchema.index({ lot_seq: 1 }, { unique: true });
lotSchema.index({ lot_number: 1 }, { unique: true });
// Finding a challan's or invoice's lot by its number.
lotSchema.index({ document_no: 1 });
// The replay guard — sparse, like the roll's: lots made on the server directly carry none.
lotSchema.index({ client_id: 1 }, { unique: true, sparse: true });
// The device's delta pull, walked by (updatedAt, _id) like rolls.
lotSchema.index({ updatedAt: 1, _id: 1 });

export const Lot = model<ILot>("Lot", lotSchema);
