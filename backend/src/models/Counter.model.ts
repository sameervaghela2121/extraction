import { Schema, model } from "mongoose";

/**
 * One document per sequence, incremented atomically. Used for the Royal Touche roll code.
 *
 * A sequence lives in the database rather than being derived from a count of existing
 * rows: two operators registering rolls at the same moment would both read the same
 * count and mint the same code. $inc on a single document cannot do that.
 */
export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    // The sequence name, e.g. "roll_code:JAYVEER". Supplied by the caller, not generated.
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: "counters", versionKey: false },
);

export const Counter = model<ICounter>("Counter", counterSchema);
