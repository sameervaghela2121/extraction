import { Schema, model } from "mongoose";

export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const Counter = model<ICounter>("Counter", counterSchema);

/**
 * Next number in a named sequence, atomically.
 *
 * Barcodes must never repeat — the sticker is the roll's permanent identity — so this
 * cannot be `count() + 1`, which hands two operators registering at the same moment the
 * same number. `$inc` with upsert is a single atomic document update: Mongo serialises
 * concurrent callers and each one gets a distinct value.
 *
 * ponytail: a document counter, not a distributed ID service. Fine to tens of thousands
 * of rolls; revisit only if roll registration ever becomes a write-throughput problem.
 */
export async function nextSequence(name: string): Promise<number> {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return counter.seq;
}
