import { Schema, model, Types } from "mongoose";

/**
 * A consignment of rolls received together — in practice the supplier's order number,
 * which every label carries under a different name (Order-no. 919837/10, Order No.Client
 * 324100791/10, SO:10972424/0, CUST. ORDER NO 122179 7/001).
 *
 * Scoped per supplier rather than globally unique: two suppliers can and will issue the
 * same order number, and they are unrelated consignments.
 */
export interface IBatch {
  _id: Types.ObjectId;
  code: string;
  supplierId: Types.ObjectId;
  receivedDate?: Date;
  remarks?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const batchSchema = new Schema<IBatch>(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    receivedDate: { type: Date },
    remarks: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

batchSchema.index({ supplierId: 1, code: 1 }, { unique: true });

export const Batch = model<IBatch>("Batch", batchSchema);
