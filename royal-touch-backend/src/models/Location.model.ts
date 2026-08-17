import { Schema, model, Types } from "mongoose";

/**
 * Where a roll physically sits. Flat on purpose: one warehouse, and an operator reads a
 * painted sign, not a tree. `zone`/`rack`/`shelf` are optional breakdowns kept so the
 * list can be grouped later; `code` is what actually gets scanned or picked.
 */
export interface ILocation {
  _id: Types.ObjectId;
  code: string;
  name?: string;
  zone?: string;
  rack?: string;
  shelf?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<ILocation>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, trim: true },
    zone: { type: String, trim: true, uppercase: true },
    rack: { type: String, trim: true, uppercase: true },
    shelf: { type: String, trim: true, uppercase: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Location = model<ILocation>("Location", locationSchema);
