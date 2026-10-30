import { Schema, model } from "mongoose";

/**
 * Named sequences ("lot" → 1, 2, 3 …). One document per sequence, advanced with an atomic
 * $inc, so two requests creating a lot at the same moment can never both get the same number.
 */
export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: "counters", versionKey: false },
);

export const Counter = model<ICounter>("Counter", counterSchema);

/** The next number in [name] — 1 for the first call. */
export async function nextSequence(name: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();
  return counter!.seq;
}
