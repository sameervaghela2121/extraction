import { Schema, model, Types } from "mongoose";

/**
 * One row per call to POST /sync/batch — what a device sent, what happened to each item,
 * and how long it took.
 *
 * Its own collection, not ActivityLog: that one hangs off a documentId and is read as a
 * document's history. This is an operations log for the offline flush, queried by time
 * and by outcome, and the two would only get in each other's way.
 *
 * Written for us, never read by the app. The device already has the response.
 */

export interface ISyncLogItem {
  index: number;
  type: string;
  client_id: string;
  status: string;
  /** Set when the item was written: the roll or movement it produced. */
  server_id?: string;
  code?: number;
  reason?: string;
  error?: string;
}

export interface ISyncLog {
  _id: Types.ObjectId;
  user_id?: Types.ObjectId;
  ip?: string;
  /** HTTP status the caller received. 200 even when items failed; 400 when the whole
   *  request was malformed and never reached the service. */
  status_code: number;
  item_count: number;
  applied: number;
  failed: number;
  skipped: number;
  resume_from?: number | null;
  /** Exactly what the device sent. The point of the log — without it a failure cannot be
   *  reproduced, because the outbox row that caused it may since have been edited. */
  request_body?: unknown;
  results?: ISyncLogItem[];
  /** Whole-request failure (schema rejection), rather than a per-item one. */
  error?: string;
  duration_ms: number;
  createdAt: Date;
  updatedAt: Date;
}

const syncLogItemSchema = new Schema<ISyncLogItem>(
  {
    index: { type: Number, required: true },
    type: { type: String, required: true },
    client_id: { type: String, required: true },
    status: { type: String, required: true },
    server_id: { type: String },
    code: { type: Number },
    reason: { type: String },
    error: { type: String },
  },
  { _id: false },
);

const syncLogSchema = new Schema<ISyncLog>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", index: true },
    ip: { type: String },
    status_code: { type: Number, required: true },
    item_count: { type: Number, required: true },
    applied: { type: Number, default: 0 },
    failed: { type: Number, default: 0, index: true },
    skipped: { type: Number, default: 0 },
    resume_from: { type: Number, default: null },
    request_body: { type: Schema.Types.Mixed },
    results: { type: [syncLogItemSchema], default: undefined },
    error: { type: String },
    duration_ms: { type: Number, required: true },
  },
  { timestamps: true, collection: "sync_logs" },
);

// The two questions this collection exists to answer: "what came in recently" and
// "what has been failing".
syncLogSchema.index({ createdAt: -1 });
syncLogSchema.index({ failed: 1, createdAt: -1 });

// ponytail: kept forever. A batch log is a few KB and the warehouse flushes a handful of
// times a day, so this will not matter for years — add a TTL index on createdAt if it
// ever does.

export const SyncLog = model<ISyncLog>("SyncLog", syncLogSchema);
