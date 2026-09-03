import { Schema, model, Types } from "mongoose";

export const REMARK_STATUSES = ["active", "inactive"] as const;
export type RemarkStatus = (typeof REMARK_STATUSES)[number];

/**
 * A standard remark an operator picks instead of typing.
 *
 * `remarks` on a stock movement stays free text — this master only fills the picker in
 * front of it, so a note nobody anticipated is still possible. Recording the code as well
 * is what makes "how many rolls came in as a colour variant this month" answerable at all.
 */
export interface IRemark {
  _id: Types.ObjectId;
  remark_code: string;
  /** What the operator reads in the picker, e.g. "Color variant / shade variation". */
  label: string;
  /** Picker order. The common ones belong at the top, not in alphabetical order. */
  sort_order?: number;
  status: RemarkStatus;
  createdAt: Date;
  updatedAt: Date;
}

const remarkSchema = new Schema<IRemark>(
  {
    // Short stable handle, like every other master here: what gets stored on a record, so
    // relabelling a remark must not orphan what referenced it.
    remark_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    sort_order: { type: Number },
    status: { type: String, enum: [...REMARK_STATUSES], default: "active", index: true },
  },
  { timestamps: true },
);

export const Remark = model<IRemark>("Remark", remarkSchema);
