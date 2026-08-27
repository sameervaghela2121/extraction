/**
 * Self-check for the offline replay guard. No database, no framework:
 *
 *   npx tsx src/utils/idempotency.selfcheck.ts
 *
 * The helpers only ever call `findOne`, so a stub with that one method exercises them
 * fully. What matters here is the discrimination in isReplayCollision — a duplicate
 * roll_number must NOT be mistaken for a replay, or a retry would be handed a roll that
 * belongs to someone else's registration.
 */
import assert from "node:assert/strict";
import type { Model } from "mongoose";
import { findReplay, isReplayCollision, resolveReplay } from "./idempotency";

const CLIENT_ID = "3f1a5c9e-0000-4000-8000-abcdefabcdef";

/** Enough of a Model for these three helpers: one findOne that answers from a map. */
function stubModel<T>(rows: Record<string, T>) {
  let calls = 0;
  const model = {
    findOne: async (filter: { client_id?: string }) => {
      calls += 1;
      return filter.client_id ? (rows[filter.client_id] ?? null) : null;
    },
  };
  return { model: model as unknown as Model<T>, callCount: () => calls };
}

/** What Mongo throws when a unique index rejects a write. */
function duplicateKeyError(field: string) {
  return Object.assign(new Error("E11000 duplicate key error"), {
    code: 11000,
    keyPattern: { [field]: 1 },
  });
}

async function main() {
  // A client_id nobody has used is not a replay — the caller does the work.
  {
    const { model } = stubModel<{ id: string }>({});
    assert.equal(await findReplay(model, CLIENT_ID), null);
  }

  // A client_id already on file returns the row it produced the first time.
  {
    const { model } = stubModel({ [CLIENT_ID]: { id: "roll-1" } });
    assert.deepEqual(await findReplay(model, CLIENT_ID), { id: "roll-1" });
  }

  // No client_id at all: the portal's requests keep their existing behaviour, and the
  // helper must not even reach the database to decide that.
  {
    const { model, callCount } = stubModel({ [CLIENT_ID]: { id: "roll-1" } });
    assert.equal(await findReplay(model, undefined), null);
    assert.equal(callCount(), 0, "a request with no client_id must not query");
  }

  // Only a client_id collision is a replay. A duplicate roll_number is a real 409 and
  // must propagate — this is the assertion that stops a retry stealing another roll.
  assert.equal(isReplayCollision(duplicateKeyError("client_id")), true);
  assert.equal(isReplayCollision(duplicateKeyError("roll_number")), false);
  assert.equal(isReplayCollision(duplicateKeyError("royal_touche_code")), false);
  assert.equal(isReplayCollision(new Error("connection reset")), false);
  assert.equal(isReplayCollision(undefined), false);

  // Losing the insert race resolves to whatever the winner wrote.
  {
    const { model } = stubModel({ [CLIENT_ID]: { id: "roll-1" } });
    const winner = await resolveReplay(model, CLIENT_ID, duplicateKeyError("client_id"));
    assert.deepEqual(winner, { id: "roll-1" });
  }

  // Rejected by the index but no winner on file: the premise is broken, so the caller
  // sees the original failure rather than a silent null.
  {
    const { model } = stubModel<{ id: string }>({});
    const original = duplicateKeyError("client_id");
    await assert.rejects(() => resolveReplay(model, CLIENT_ID, original), original);
  }

  console.log("idempotency self-check: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
