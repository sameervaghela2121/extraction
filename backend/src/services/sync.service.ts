import { ZodError, type z } from "zod";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { zodMessage } from "../middleware/validate.middleware";
import { ApiError } from "../utils/ApiError";
import { findReplay } from "../utils/idempotency";
import { logger } from "../utils/logger";
import { recordMovementSchema } from "../validators/stock.validators";
import type { syncBatchSchema } from "../validators/sync.validators";
import { materialRollsService } from "./materialRolls.service";
import { stockService } from "./stock.service";

/**
 * Batch flush: a device sends its whole outbox in one request instead of one call per item.
 *
 * Nothing here does its own writing. Each item is handed to the same service method the
 * single-item endpoint uses, so validation, roll-code minting, stock arithmetic and the
 * client_id replay guard all behave identically whether a roll arrives alone or in a batch
 * of forty. A second write path into these collections is the thing this must never become.
 *
 * Two properties make a partial failure recoverable:
 *
 *  - Items run **in order, one at a time**. remaining_weight is derived from the order
 *    movements are applied in, so a batch is a queue, not a set.
 *  - Every item carries its **own** client_id. A batch-level id could not describe "5 of 8
 *    written" — the retry would be told the batch was already done while three rolls had
 *    never moved. Per-item ids make the retry trivial: the 5 come back as replays and the
 *    remaining 3 are created.
 */

type BatchInput = z.infer<typeof syncBatchSchema>;
type Item = BatchInput["items"][number];

type ItemResult = {
  index: number;
  client_id: string;
  type: Item["type"];
  status: "ok" | "failed" | "skipped";
  data?: unknown;
  /** Shown to the operator as-is. Never a stack trace, never a Mongo message. */
  error?: string;
  /** The status the same item would have returned from its own endpoint. */
  code?: number;
  /** Machine-readable class, so the app can branch without matching on prose. */
  reason?: FailureReason;
  /** Which fields were rejected, for highlighting them on the form. Validation only. */
  fields?: Record<string, string[]>;
  /** The underlying message, for the app's own log and bug reports. Not for display. */
  detail?: string;
};

/**
 * Why an item failed, as something the client can switch on.
 *
 * The `error` string is written for a human and will be reworded; matching on it would
 * break silently the first time someone improves the wording. These will not change.
 */
type FailureReason =
  | "validation" // the item is malformed or breaks a rule — editing it might fix it
  | "duplicate" // something unique already exists (roll_number)
  | "conflict" // the roll is not in a state that allows this (already out, not out, used)
  | "not_found" // a referenced record is gone
  | "forbidden" // the account may not do this
  | "server_error"; // our bug — retry later, the item itself is fine

function reasonFor(status: number): FailureReason {
  if (status === 409) return "conflict";
  if (status === 404) return "not_found";
  if (status === 403) return "forbidden";
  if (status >= 500) return "server_error";
  return "validation";
}

/** Enough to identify the failure in a bug report, short enough not to be a payload. */
const MAX_DETAIL = 300;

function errorOf(
  err: unknown,
  item: Item,
  index: number,
): Pick<ItemResult, "error" | "code" | "reason" | "fields" | "detail"> {
  if (err instanceof ApiError) {
    const duplicate = err.statusCode === 409 && /already exists/i.test(err.message);
    return {
      error: err.message,
      code: err.statusCode,
      reason: duplicate ? "duplicate" : reasonFor(err.statusCode),
      // Zod's field breakdown when the route-level validator produced it.
      fields: (err.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors,
    };
  }

  // The movement rules run inside the loop rather than in the route's validate() — see
  // runItem — so their failures arrive here as ZodErrors and must read as 400s, not 500s.
  if (err instanceof ZodError) {
    return {
      error: zodMessage(err),
      code: 400,
      reason: "validation",
      fields: err.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // Anything not deliberately thrown is a bug. Logged in full here — without this a real
  // failure inside the loop vanishes, because the request still returns 200 and the item
  // only says "something went wrong". `detail` carries the raw message to the device too,
  // so a report from the warehouse arrives with something to act on rather than a shrug.
  logger.error(
    `[sync] item ${index} (${item.type}, client_id ${item.client_id}) failed unexpectedly:`,
    err,
  );
  return {
    error: "Something went wrong on our side. Please try again.",
    code: 500,
    reason: "server_error",
    detail: (err as Error)?.message?.slice(0, MAX_DETAIL),
  };
}

async function runItem(
  item: Item,
  actingUserId: string,
  rollIdsInBatch: Map<string, string>,
): Promise<unknown> {
  if (item.type === "roll") {
    const roll = await materialRollsService.create(
      { ...item.body, client_id: item.client_id },
      actingUserId,
    );
    // Remembered so a movement later in this same batch can point at a roll that had no
    // server id when the device queued it.
    rollIdsInBatch.set(item.client_id, roll.id);
    return roll;
  }

  const body = { ...item.body, client_id: item.client_id };

  if (!body.roll_id && item.roll_client_id) {
    const fromBatch = rollIdsInBatch.get(item.roll_client_id);
    if (fromBatch) {
      body.roll_id = fromBatch;
    } else {
      // Not in this batch: the roll may have synced in an earlier call, so the client_id
      // is still the only handle the device has for it.
      const earlier = await findReplay(MaterialRoll, item.roll_client_id);
      if (!earlier) {
        throw ApiError.badRequest(
          "roll_client_id does not match any roll — send the roll's own item before the movement that uses it",
        );
      }
      body.roll_id = earlier._id.toString();
    }
  }

  // Now that roll_id is known, the per-type rules can be applied — the same ones
  // POST /stock/movements validates against, so a batched movement is held to exactly
  // the same standard as a single one.
  return stockService.recordMovement(recordMovementSchema.parse(body), actingUserId);
}

export const syncService = {
  /**
   * Returns 200 with a per-item verdict even when items fail. A batch is not a transaction:
   * items already written stay written, and telling the client which ones those were is the
   * whole point. Failing the request outright would hide it.
   */
  async flush(input: BatchInput, actingUserId: string) {
    const results: ItemResult[] = [];
    const rollIdsInBatch = new Map<string, string>();
    let halted = false;

    for (const [index, item] of input.items.entries()) {
      const base = { index, client_id: item.client_id, type: item.type };

      // Once one item fails, everything behind it is reported untouched rather than
      // attempted. The queue is ordered because later items depend on earlier ones — an
      // OUT against a roll whose registration was just rejected cannot succeed, and
      // pushing on would scatter half-applied work through the batch.
      if (halted) {
        results.push({ ...base, status: "skipped" });
        continue;
      }

      try {
        results.push({ ...base, status: "ok", data: await runItem(item, actingUserId, rollIdsInBatch) });
      } catch (err) {
        results.push({ ...base, status: "failed", ...errorOf(err, item, index) });
        halted = true;
      }
    }

    const applied = results.filter((r) => r.status === "ok").length;
    return {
      applied,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      // The index to resume from. Everything before it is on the server; the client can
      // drop those outbox rows and retry from here once the failure is dealt with.
      resume_from: halted ? applied : null,
      results,
    };
  },
};
