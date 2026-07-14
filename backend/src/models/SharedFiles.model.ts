import { Schema, model, Types } from "mongoose";
import { env } from "../config/env";

/**
 * Maps onto the `Files` collection already written by invoice-generator-backend
 * (raw pymongo, no enforced schema) — strict:false so unknown/extra fields survive round-trips.
 */
export interface ISharedFile {
  _id: Types.ObjectId;
  job_id: string;
  filename: string;
  mime: string;
  size: number;
  path: string;
  idx: number;
  status: "processing" | "done" | "failed";
  error?: string;
  invoice_count?: number;
  title?: string;
  created_at: Date;
}

const sharedFileSchema = new Schema<ISharedFile>(
  {
    job_id: { type: String, index: true },
    filename: { type: String },
    mime: { type: String },
    size: { type: Number },
    path: { type: String },
    idx: { type: Number },
    status: { type: String },
    error: { type: String },
    invoice_count: { type: Number },
    title: { type: String },
    created_at: { type: Date },
  },
  { strict: false, versionKey: false, collection: env.filesCollection },
);

export const SharedFile = model<ISharedFile>("SharedFile", sharedFileSchema);
