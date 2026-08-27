import type { HydratedDocument, Model } from "mongoose";

/**
 * Offline replay protection.
 *
 * A phone in the warehouse records movements with no signal and flushes them when it
 * finds one. That flush is not reliable: the request can succeed and the response can be
 * lost, leaving the device certain it must retry something the server already did. Twice
 * -recorded stock is worse than not-recorded stock, because nobody notices it.
 *
 * So the device mints a UUID per queued write and sends it as `client_id`. The server
 * stores it and, on a second sighting, returns what it stored the first time instead of
 * doing the work again.
 */

/** Mongo's duplicate-key error code. Not exported by the driver as a constant. */
const DUPLICATE_KEY = 11000;

/**
 * The write this `client_id` already produced, or null if it is new.
 *
 * Null for a request without a client_id at all: the web portal doesn't queue anything
 * offline, and forcing it to invent ids for writes it will never replay is ceremony.
 * Those requests keep the old at-least-once behaviour, which is what they have today.
 */
// The return type is stated rather than inferred: findOne on a generic Model<T> widens to
// a union of overload results that callers cannot then call .populate on.
export async function findReplay<T>(
  model: Model<T>,
  clientId?: string,
): Promise<HydratedDocument<T> | null> {
  if (!clientId) return null;
  return model.findOne({ client_id: clientId } as never) as Promise<HydratedDocument<T> | null>;
}

/**
 * Did this write lose the race to another flush of the same queued item?
 *
 * Only true for a collision on client_id. A duplicate roll_number is a different
 * problem with a different answer (409, "that roll already exists"), and swallowing it
 * as a replay would hand the caller somebody else's roll.
 */
export function isReplayCollision(err: unknown): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === DUPLICATE_KEY && e?.keyPattern?.client_id !== undefined;
}

/**
 * Re-read after losing that race. The winner's document is the answer for both requests.
 *
 * Throws the original error if nothing comes back — that would mean the index rejected a
 * write whose winner does not exist, so the assumption behind this whole path is wrong
 * and the caller should see the real failure rather than a null.
 */
export async function resolveReplay<T>(
  model: Model<T>,
  clientId: string,
  original: unknown,
): Promise<HydratedDocument<T>> {
  const winner = await findReplay(model, clientId);
  if (!winner) throw original;
  return winner;
}
