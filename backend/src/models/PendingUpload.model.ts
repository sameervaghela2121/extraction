import { Schema, model, Types } from "mongoose";

/**
 * What Node itself minted at presign time, per (jobId, userId) — the sole source of truth
 * for which GCS objects a confirm() call is allowed to touch. Never take an objectPath from
 * the client at confirm time: reconstruct it from here instead, or a caller could point
 * confirm() at any object in the shared bucket (including another user's upload) by simply
 * echoing back a different path. Expires on its own via the `createdAt` TTL index — a
 * presigned URL is only valid 15 minutes, so an unconfirmed session is dead weight past that.
 */
export interface IPendingUploadFile {
  idx: number;
  filename: string;
  mimetype: string;
  objectPath: string;
}

export interface IPendingUpload {
  _id: Types.ObjectId;
  jobId: string;
  userId: Types.ObjectId;
  files: IPendingUploadFile[];
  createdAt: Date;
}

const pendingUploadSchema = new Schema<IPendingUpload>({
  jobId: { type: String, required: true, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  files: [
    {
      _id: false,
      idx: { type: Number, required: true },
      filename: { type: String, required: true },
      mimetype: { type: String, required: true },
      objectPath: { type: String, required: true },
    },
  ],
  createdAt: { type: Date, default: () => new Date(), expires: "30m" },
});

export const PendingUpload = model<IPendingUpload>("PendingUpload", pendingUploadSchema);
