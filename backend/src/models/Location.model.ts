import { Schema, model, Types } from "mongoose";

export interface ILocation {
  _id: Types.ObjectId;
  location_code: string;
  /** What the operator picks from the list, e.g. "Godown A side 1". */
  name: string;
  /** Free text so a new building needs no code change. */
  godown?: string;
  /** Where in the list this sits. Godowns are walked in a physical order, not alphabetical. */
  sort_order?: number;
  is_active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<ILocation>(
  {
    // Short stable handle for labels and search. Rolls and movements reference the _id.
    location_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    godown: { type: String, trim: true },
    sort_order: { type: Number },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const Location = model<ILocation>("Location", locationSchema);
