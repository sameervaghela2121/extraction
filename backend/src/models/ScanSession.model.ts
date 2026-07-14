import { Schema, model, Types } from "mongoose";

export type ScanSessionStatus = "pending" | "capturing" | "uploaded" | "expired";

export interface IScanSession {
  _id: Types.ObjectId;
  token: string;
  expiresAt: Date;
  userId: Types.ObjectId;
  status: ScanSessionStatus;
  pages: Array<{ filename: string; data: Buffer; mime: string }>;
  resultDocumentId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const scanSessionSchema = new Schema<IScanSession>(
  {
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "capturing", "uploaded", "expired"], default: "pending" },
    pages: [
      {
        filename: { type: String, required: true },
        data: { type: Buffer, required: true },
        mime: { type: String, required: true },
      },
    ],
    resultDocumentId: { type: Schema.Types.ObjectId, ref: "Document" },
  },
  { timestamps: true },
);

export const ScanSession = model<IScanSession>("ScanSession", scanSessionSchema);
