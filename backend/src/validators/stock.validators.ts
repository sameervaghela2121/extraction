import { z } from "zod";
import { TRANSACTION_TYPES, type TransactionType } from "../models/StockTransaction.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
// Only paths this API minted: "rolls/YYYY/MM/<uuid>.<ext>". Rejecting anything else stops
// a client attaching — and then getting a signed read URL for — an arbitrary object in the
// bucket, which also holds invoice scans.
const objectPath = z
  .string()
  .regex(/^rolls\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i, "Not a valid upload path");

/** Enough for a couple of angles per movement without turning the ledger into an album. */
const MAX_MOVEMENT_PHOTOS = 4;

export const movementFieldsSchema = z
  .object({
    // Optional only so `is_consumed` can stand in for it — the transform below fills it,
    // and the rules that follow reject a movement that named neither.
    transaction_type: z.enum(TRANSACTION_TYPES).optional(),
    /**
     * The phone's shorthand for "this roll is finished".
     *
     * A roll running out is the one movement with nothing to measure: no scale reading, no
     * destination, no corrected figure — the operator just sees an empty core. So the app
     * sends this flag alone and the server works out the rest, rather than making it fake a
     * RETURN of 0 or an ADJUSTMENT to 0. It becomes transaction_type CONSUME below, so the
     * ledger still carries one honest row for it.
     */
    is_consumed: z.literal(true).optional(),
    transaction_date: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    // Optional for CONSUME only, where it is read off the roll — the app marking a roll
    // finished should not have to remember which material it was.
    material_id: objectId.optional(),
    roll_id: objectId.optional(),
    vendor_id: objectId.optional(),
    // Weight is the stock figure everywhere below; a roll's `quantity` (length/pieces)
    // is reference data and never moves.
    weight: z.number().positive().optional(),
    // ADJUSTMENT only: the corrected weight, from which the delta is derived.
    new_weight: z.number().nonnegative().optional(),
    // RETURN only: what the roll weighs coming back. Equal to what went out means nothing
    // was used; 0 means the whole roll was consumed.
    returned_weight: z.number().nonnegative().optional(),
    // OUT only: where the roll is going. The only thing an OUT needs.
    location: z.string().trim().min(1).optional(),
    issued_to: z.string().trim().optional(),
    remarks: z.string().trim().optional(),
    // A code from the remark master, alongside (not instead of) the free text.
    remark_code: z.string().trim().min(1).optional(),
    // OUT/RETURN: photos of the roll taken as it leaves and as it comes back. GCS object
    // paths returned by POST /media/upload — not URLs, and not raw files.
    photo_paths: z.array(objectPath).max(MAX_MOVEMENT_PHOTOS).optional(),
    // Offline flush: the device's own id for this queued movement. Sending it makes the
    // movement idempotent — a retry returns the row already written rather than moving
    // the same stock a second time. See utils/idempotency.ts.
    client_id: z.string().uuid("client_id must be a UUID").optional(),
  });

/**
 * The fields above plus the rules that depend on transaction_type. Split from the object
 * itself so the batch endpoint can validate an item whose roll_id is not known yet — it
 * arrives as roll_client_id and is resolved server-side, then checked against this.
 */
export const recordMovementSchema = movementFieldsSchema
  // Normalise the shorthand before any rule sees it, so the service only ever handles one
  // shape: a transaction_type. req.body is replaced with this output (see validate()).
  .transform((v) => (v.is_consumed && !v.transaction_type ? { ...v, transaction_type: "CONSUME" as const } : v))
  .superRefine((v, ctx) => {
    if (!v.transaction_type) {
      ctx.addIssue({
        code: "custom",
        message: "transaction_type is required (or send is_consumed: true)",
        path: ["transaction_type"],
      });
      return;
    }

    // CONSUME is the flag path: the roll is empty, and there is nothing to weigh or place.
    if (v.transaction_type === "CONSUME") {
      if (!v.roll_id) {
        ctx.addIssue({ code: "custom", message: "CONSUME requires roll_id", path: ["roll_id"] });
      }
      for (const [field, label] of [
        ["weight", "weight"],
        ["new_weight", "new_weight"],
        ["returned_weight", "returned_weight"],
      ] as const) {
        if (v[field] !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `A consumed roll has nothing left to measure — drop ${label}`,
            path: [field],
          });
        }
      }
      return;
    }

    if (!v.material_id) {
      ctx.addIssue({ code: "custom", message: "material_id is required", path: ["material_id"] });
    }

    // A whole roll goes out to a place; nothing is consumed yet, so no quantity.
    if (v.transaction_type === "OUT") {
      if (!v.roll_id) {
        ctx.addIssue({ code: "custom", message: "OUT requires roll_id", path: ["roll_id"] });
      }
      if (!v.location) {
        ctx.addIssue({
          code: "custom",
          message: "Where is the roll going? location is required",
          path: ["location"],
        });
      }
      if (v.weight !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "A whole roll goes out — the weight used is recorded when it returns",
          path: ["weight"],
        });
      }
      return;
    }

    if (v.transaction_type === "RETURN") {
      if (!v.roll_id) {
        ctx.addIssue({ code: "custom", message: "RETURN requires roll_id", path: ["roll_id"] });
      }
      if (v.returned_weight === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "RETURN requires returned_weight — what the roll weighs coming back",
          path: ["returned_weight"],
        });
      }
      return;
    }

    if (v.transaction_type === "ADJUSTMENT") {
      if (!v.roll_id) {
        ctx.addIssue({ code: "custom", message: "ADJUSTMENT requires roll_id", path: ["roll_id"] });
      }
      if (v.new_weight === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "ADJUSTMENT requires new_weight",
          path: ["new_weight"],
        });
      }
      // An unexplained correction to a stock figure is the one thing nobody can audit later.
      if (!v.remarks) {
        ctx.addIssue({ code: "custom", message: "ADJUSTMENT requires remarks", path: ["remarks"] });
      }
      return;
    }
    if (v.weight === undefined) {
      ctx.addIssue({ code: "custom", message: "weight is required for IN", path: ["weight"] });
    }
  })
  // transaction_type is optional on the object only so `is_consumed` can supply it; the
  // rule above rejects a movement that has neither, so by here it is always set.
  .transform((v) => ({ ...v, transaction_type: v.transaction_type as TransactionType }));

export const listMovementsQuerySchema = z.object({
  material_id: objectId.optional(),
  roll_id: objectId.optional(),
  // Alternative to roll_id for a client holding the number printed on the roll.
  roll_number: z.string().trim().min(1).optional(),
  transaction_type: z.enum(TRANSACTION_TYPES).optional(),
  // Delta pull, same contract as the roll list: switches the sort to updatedAt ascending
  // so a device can walk its backlog and checkpoint on the last row it saw.
  updated_after: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

export const summaryQuerySchema = z.object({
  material_id: objectId.optional(),
});
