import { Schema, model, Types } from "mongoose";

export interface IActivityLog {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  actor: string;
  action: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
}

const activityLogSchema = new Schema<IActivityLog>({
  documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true, index: true },
  actor: { type: String, required: true },
  action: { type: String, required: true },
  timestamp: { type: Date, default: () => new Date() },
  meta: { type: Schema.Types.Mixed },
});

export const ActivityLog = model<IActivityLog>("ActivityLog", activityLogSchema);
