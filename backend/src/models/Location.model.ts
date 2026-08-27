import { Schema, model, Types } from "mongoose";

export const LOCATION_STATUSES = ["active", "inactive"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export interface ILocation {
  _id: Types.ObjectId;
  location_code: string;
  /** What the operator picks from the list, e.g. "Godown A side 1". */
  name: string;
  /** Free text so a new building needs no code change. */
  godown?: string;
  /** Where in the list this sits. Godowns are walked in a physical order, not alphabetical. */
  sort_order?: number;
  status: LocationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<ILocation>(
  {
    // Short stable handle. Renaming a location must not break what referenced it.
    location_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    godown: { type: String, trim: true },
    sort_order: { type: Number },
    status: { type: String, enum: [...LOCATION_STATUSES], default: "active", index: true },
  },
  { timestamps: true },
);

export const Location = model<ILocation>("Location", locationSchema);
