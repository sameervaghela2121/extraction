import { z } from "zod";
import { ROLL_STATUSES } from "../models/MaterialRoll.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
// Only paths this API minted: "rolls/YYYY/MM/<uuid>.<ext>". Rejecting anything else stops
// a client pointing a roll at an arbitrary object in the bucket.
const objectPath = z
  .string()
  .regex(/^rolls\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i, "Not a valid upload path");

export const createRollSchema = z.object({
  roll_number: z.string().trim().min(1, "Roll number is required"),
  material_id: objectId,
  vendor_id: objectId.optional(),
  batch_no: z.string().trim().optional(),
  // Both optional: a roll may be registered from its label before it is weighed, and a
  // roll sold by length may never carry a weight at all.
  initial_weight: z.number().positive("Weight must be greater than 0").optional(),
  remaining_weight: z.number().nonnegative().optional(),
  quantity: z.number().positive("Quantity must be greater than 0").optional(),
  unit: z.string().trim().min(1).optional(),
  gsm: z.number().nonnegative().optional(),
  width_mm: z.number().nonnegative().optional(),
  location: z.string().trim().optional(),
  received_date: z.string().datetime({ offset: true }).or(z.string().date()),
  status: z.enum(ROLL_STATUSES).optional(),
  // GCS object paths returned by POST /media/upload — not URLs, and not raw files.
  tag_photo_path: objectPath.optional(),
  stitched_barcode_photo_path: objectPath.optional(),
  side1_photo_path: objectPath.optional(),
  side2_photo_path: objectPath.optional(),
});

export const updateRollSchema = createRollSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" })
  // Editing either of these here would move stock with no ledger row behind it —
  // status because a roll leaving IN_STOCK drops out of the on-hand totals. Both stay
  // in the schema so the caller gets this explanation rather than a silently ignored
  // update.
  .refine((v) => v.remaining_weight === undefined, {
    message: "Stock changes must be recorded as a movement, not edited on the roll",
    path: ["remaining_weight"],
  })
  .refine((v) => v.status === undefined, {
    message: "A roll's status follows its movements — issue or consume it instead",
    path: ["status"],
  });

export const listRollsQuerySchema = z.object({
  q: z.string().trim().optional(),
  material_id: objectId.optional(),
  vendor_id: objectId.optional(),
  status: z.enum(ROLL_STATUSES).optional(),
  location: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});
