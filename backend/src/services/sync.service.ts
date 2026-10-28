import { ZodError, type z } from "zod";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { Vendor } from "../models/Vendor.model";
import { zodMessage } from "../middleware/validate.middleware";
import { ApiError } from "../utils/ApiError";
import { findReplay } from "../utils/idempotency";
import { logger } from "../utils/logger";
import { recordMovementSchema } from "../validators/stock.validators";
import type { syncBatchSchema } from "../validators/sync.validators";
import { materialRollsService } from "./materialRolls.service";
import { stockService } from "./stock.service";
import { vendorsService } from "./vendors.service";

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
 *  - Items run **one at a time**, master data first and everything else in the order the
 *    device queued it. remaining_weight is derived from the order movements are applied
 *    in, so the roll/movement part of a batch is a queue, not a set.
 *  - Every item carries its **own** client_id. A batch-level id could not describe "5 of 8
 *    written" — the retry would be told the batch was already done while three rolls had
 *    never moved. Per-item ids make the retry trivial: the 5 come back as replays and the
 *    remaining 3 are created.
 *
 * A failed item does not stop the batch. Only the items that depend on it — a roll whose
 * vendor was rejected, a movement whose roll was rejected or whose earlier movement on the
 * same roll was — are reported "skipped". Everything unrelated still goes through, so one
 * duplicate roll number cannot hold up a whole godown's day of scans.
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
  | "server_error" // our bug — retry later, the item itself is fine
  | "dependency_failed"; // skipped, not failed: an item it needs failed earlier in this batch

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

/**
 * Master data added on the device. These run before the rolls and movements in the same
 * batch, whatever order they were queued in — a roll naming a supplier the phone invented
 * offline must find that supplier already in the database, not a "vendor not found".
 */
const MASTER_TYPES = new Set<Item["type"]>(["vendor", "supplier_code"]);

/** Server ids for things created earlier in this same flush, keyed by their client_id. */
type BatchIds = {
  rolls: Map<string, string>;
  vendors: Map<string, string>;
};

/**
 * Turn a device's client_id for a vendor into a server id.
 *
 * Looks in this batch first, then at what earlier flushes wrote: a vendor added last week
 * and a vendor added two items ago are both things the device only knows by client_id.
 */
async function resolveVendorId(clientId: string, ids: BatchIds): Promise<string> {
  const fromBatch = ids.vendors.get(clientId);
  if (fromBatch) return fromBatch;

  const earlier = await findReplay(Vendor, clientId);
  if (!earlier) {
    throw ApiError.badRequest(
      "vendor_client_id does not match any vendor — send the vendor's own item before whatever uses it",
    );
  }
  return earlier._id.toString();
}

/** The roll a movement is about, as one key whichever way the device named it. */
function movementRollKey(item: Extract<Item, { type: "movement" }>): string | undefined {
  if (item.body.roll_id) return `roll:${item.body.roll_id}`;
  if (item.roll_client_id) return `roll_client:${item.roll_client_id}`;
  return undefined;
}

/**
 * The keys a failure of this item blocks later items by: its own client_id, and for a
 * movement, its roll — a RETURN behind a rejected OUT on the same roll would be applied
 * against the wrong state.
 */
function keysOf(item: Item): string[] {
  const keys = [`client:${item.client_id}`];
  if (item.type === "movement") {
    const roll = movementRollKey(item);
    if (roll) keys.push(roll);
  }
  return keys;
}

/** The keys of earlier items in the batch this one cannot succeed without. */
function dependenciesOf(item: Item): string[] {
  if (item.type === "roll") {
    const vendor = item.vendor_client_id ?? item.body.vendor_client_id;
    return vendor ? [`client:${vendor}`] : [];
  }
  if (item.type === "supplier_code") {
    return item.body.vendor_client_id ? [`client:${item.body.vendor_client_id}`] : [];
  }
  if (item.type === "movement") {
    const deps: string[] = [];
    if (item.roll_client_id) deps.push(`client:${item.roll_client_id}`);
    const roll = movementRollKey(item);
    if (roll) deps.push(roll);
    return deps;
  }
  return [];
}

async function runItem(item: Item, actingUserId: string, ids: BatchIds): Promise<unknown> {
  if (item.type === "vendor") {
    const vendor = await vendorsService.create({ ...item.body, client_id: item.client_id });
    // Remembered so a roll or a supplier-code item later in this batch can point at a
    // vendor that had no server id when the device queued it.
    ids.vendors.set(item.client_id, vendor.id);
    return vendor;
  }

  if (item.type === "supplier_code") {
    const vendorId =
      item.body.vendor_id ??
      (item.body.vendor_client_id
        ? await resolveVendorId(item.body.vendor_client_id, ids)
        : undefined);
    if (!vendorId) {
      throw ApiError.badRequest("Send either vendor_id or vendor_client_id");
    }
    return vendorsService.addPapers(vendorId, item.body.papers);
  }

  if (item.type === "roll") {
    // Accepted from either spot — the item's own sibling field (the documented shape) or
    // inside body (what a client mirroring supplier_code's shape sends instead). See the
    // comment on rollItem in sync.validators.ts.
    const { vendor_client_id: bodyVendorClientId, ...body } = item.body;
    const vendorClientId = item.vendor_client_id ?? bodyVendorClientId;
    const vendorId = body.vendor_id ?? (vendorClientId ? await resolveVendorId(vendorClientId, ids) : undefined);
    if (!vendorId) {
      throw ApiError.badRequest("Send either vendor_id or vendor_client_id on the roll");
    }
    const roll = await materialRollsService.create(
      { ...body, vendor_id: vendorId, client_id: item.client_id },
      actingUserId,
    );
    // Remembered so a movement later in this same batch can point at a roll that had no
    // server id when the device queued it.
    ids.rolls.set(item.client_id, roll.id);
    return roll;
  }

  const body = { ...item.body, client_id: item.client_id };

  if (!body.roll_id && item.roll_client_id) {
    const fromBatch = ids.rolls.get(item.roll_client_id);
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
    const ids: BatchIds = { rolls: new Map(), vendors: new Map() };
    // Keys (see keysOf) of every item that failed or was skipped so far in this batch.
    const blocked = new Set<string>();

    // Master data first, each group keeping the order the device queued it in. The index
    // travels with the item so every result still names the position it arrived at — the
    // device maps results back to its outbox by index, not by run order.
    const numbered = input.items.map((item, index) => ({ item, index }));
    const ordered = [
      ...numbered.filter((e) => MASTER_TYPES.has(e.item.type)),
      ...numbered.filter((e) => !MASTER_TYPES.has(e.item.type)),
    ];

    for (const { item, index } of ordered) {
      const base = { index, client_id: item.client_id, type: item.type };

      // An item that needs something already rejected in this batch is reported untouched
      // rather than attempted: an OUT against a roll whose registration was just rejected
      // cannot succeed, and a RETURN behind a rejected OUT would be applied out of order.
      // Its own keys are blocked in turn, so the whole chain behind a failure waits.
      if (dependenciesOf(item).some((key) => blocked.has(key))) {
        results.push({ ...base, status: "skipped", reason: "dependency_failed" });
        for (const key of keysOf(item)) blocked.add(key);
        continue;
      }

      try {
        results.push({ ...base, status: "ok", data: await runItem(item, actingUserId, ids) });
      } catch (err) {
        results.push({ ...base, status: "failed", ...errorOf(err, item, index) });
        for (const key of keysOf(item)) blocked.add(key);
      }
    }

    // Back into the order the device sent, so it can walk its outbox alongside.
    results.sort((a, b) => a.index - b.index);

    // The index to resume from: the first item that did not get written. Everything before
    // it is on the server, so the client can drop those outbox rows and retry from here
    // once the failure is dealt with. Computed from the results rather than counted,
    // because master data runs ahead of its position — a failure in it can leave earlier
    // indexes untouched.
    const firstUnwritten = results.find((r) => r.status !== "ok");
    const failed = results.filter((r) => r.status === "failed");
    const skipped = results.filter((r) => r.status === "skipped").length;

    // One line per batch that did not fully apply, so a stuck device can be traced in the
    // service logs without the SyncLog's full request body.
    if (failed.length || skipped) {
      logger.warn(
        `[sync] user ${actingUserId}: ${results.length - failed.length - skipped} ok, ` +
          `${failed.length} failed, ${skipped} skipped — ` +
          failed.map((r) => `#${r.index} ${r.type} ${r.reason} (${r.client_id})`).join("; "),
      );
    }

    return {
      applied: results.length - failed.length - skipped,
      failed: failed.length,
      skipped,
      resume_from: firstUnwritten?.index ?? null,
      results,
    };
  },
};
