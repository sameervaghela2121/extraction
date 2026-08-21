import { z } from "zod";
import { TRANSACTION_TYPES } from "../models/StockTransaction.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
// Only paths this API minted: "rolls/YYYY/MM/<uuid>.<ext>". Rejecting anything else stops
// a client attaching — and then getting a signed read URL for — an arbitrary object in the
// bucket, which also holds invoice scans.
const objectPath = z
  .string()
  .regex(/^rolls\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i, "Not a valid upload path");

/** Enough for a couple of angles per movement without turning the ledger into an album. */
const MAX_MOVEMENT_PHOTOS = 4;

export const recordMovementSchema = z
  .object({
    transaction_type: z.enum(TRANSACTION_TYPES),
    transaction_date: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    material_id: objectId,
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
    // OUT/RETURN: photos of the roll taken as it leaves and as it comes back. GCS object
    // paths returned by POST /media/upload — not URLs, and not raw files.
    photo_paths: z.array(objectPath).max(MAX_MOVEMENT_PHOTOS).optional(),
  })
  .superRefine((v, ctx) => {
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
  });

export const listMovementsQuerySchema = z.object({
  material_id: objectId.optional(),
  roll_id: objectId.optional(),
  transaction_type: z.enum(TRANSACTION_TYPES).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

export const summaryQuerySchema = z.object({
  material_id: objectId.optional(),
});
