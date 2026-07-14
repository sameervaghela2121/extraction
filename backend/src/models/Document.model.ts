import { Schema, model, Types } from "mongoose";

export type DocumentSource = "upload" | "scan" | "email";
export type DocumentWorkflowStatus = "pending" | "verified" | "archived";

export interface IDocument {
  _id: Types.ObjectId;
  fileId: Types.ObjectId;
  jobId: string;
  title: string;
  status: DocumentWorkflowStatus;
  source: DocumentSource;
  ownerId: Types.ObjectId;
  uploadedAt: Date;
  verifiedAt?: Date;
  verifiedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true, index: true },
    jobId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    status: { type: String, enum: ["pending", "verified", "archived"], default: "pending", index: true },
    source: { type: String, enum: ["upload", "scan", "email"], required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    uploadedAt: { type: Date, default: () => new Date() },
    verifiedAt: { type: Date },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const DocumentModel = model<IDocument>("Document", documentSchema);
