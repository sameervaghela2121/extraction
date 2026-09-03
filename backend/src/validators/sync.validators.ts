import { z } from "zod";
import { createRollSchema } from "./materialRolls.validators";
import { basePaperSchema, createVendorSchema } from "./vendors.validators";
import { movementFieldsSchema } from "./stock.validators";

/**
 * One request carrying a whole flush.
 *
 * The per-item bodies are the create schemas themselves, not copies: a field added to a
 * roll registration has to reach this endpoint too, and a second hand-maintained schema
 * would drift the first time somebody forgets.
 */

/** Enough for a shift's backlog in one call, small enough that a request can't stall a worker. */
const MAX_BATCH = 50;

// client_id is optional on the single-write schemas — the portal never sends one. In a
// batch it is the only thing that makes a retry safe, so it is required here.
const requiredClientId = z.string().uuid("client_id must be a UUID");

/** A vendor added on the device — a supplier that did not exist when it went offline. */
const vendorItem = z.object({
  type: z.literal("vendor"),
  client_id: requiredClientId,
  body: createVendorSchema,
});

/**
 * Supplier codes (papers) added to a vendor. Merged by code server-side, so replaying this
 * item is a no-op rather than a second copy of the same paper.
 */
const supplierCodeItem = z.object({
  type: z.literal("supplier_code"),
  client_id: requiredClientId,
  body: z.object({
    /** The vendor's server id, when the device already knows it. */
    vendor_id: z.string().optional(),
    /** The client_id of a vendor added in this same batch (or an earlier one), for codes
     *  added to a supplier that has no server id yet. Ignored when vendor_id is set. */
    vendor_client_id: z.string().uuid().optional(),
    papers: z.array(basePaperSchema).min(1, "Send at least one supplier code"),
  }),
});

const rollItem = z.object({
  type: z.literal("roll"),
  client_id: requiredClientId,
  // vendor_id is relaxed to optional here and nowhere else: a roll received from a
  // supplier the device added while offline has only that supplier's client_id. Exactly
  // one of the two must be present, which the service checks once it has resolved the
  // client_id — a refine here would reject a roll whose vendor is being created in this
  // same batch, which is the main thing a batch is for.
  body: createRollSchema.partial({ vendor_id: true }),
  /**
   * The client_id of a vendor added in this same batch, for a roll received from a
   * supplier that has no server id yet. Resolved server-side before the roll is created.
   * Ignored when body.vendor_id is already set.
   */
  vendor_client_id: z.string().uuid().optional(),
});

const movementItem = z
  .object({
    type: z.literal("movement"),
    client_id: requiredClientId,
    // Fields only. The per-type rules — "OUT requires roll_id" and the rest — are applied
    // in the service, after roll_client_id has been turned into a real roll_id. Checking
    // them here would reject a movement against a roll being registered in this same
    // batch, which is the main thing a batch is for.
    body: movementFieldsSchema,
    /**
     * The client_id of a roll registered earlier in this same batch, for a movement against
     * a roll that has no server id yet. Resolved server-side just before the movement runs.
     * Ignored when body.roll_id is already set.
     */
    roll_client_id: z.string().uuid().optional(),
  });
// Deliberately a plain object, not a .refine'd one: discriminatedUnion below only accepts
// object schemas. A movement missing its roll is caught by the movement rules in the
// service, which already word it per transaction type.

export const syncBatchSchema = z.object({
  items: z
    .array(z.discriminatedUnion("type", [vendorItem, supplierCodeItem, rollItem, movementItem]))
    .min(1, "Nothing to sync")
    .max(MAX_BATCH, `A batch cannot exceed ${MAX_BATCH} items — send the rest in the next call`)
    // Two items sharing a client_id inside one request is a client bug, and letting it
    // through would make the second one look like a successful replay of the first.
    .refine(
      (items) => new Set(items.map((i) => i.client_id)).size === items.length,
      "Every item needs its own client_id",
    ),
});
