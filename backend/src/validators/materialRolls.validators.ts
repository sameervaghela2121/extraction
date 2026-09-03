import { z } from "zod";
import { ROLL_STATUSES } from "../models/MaterialRoll.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
// Only paths this API minted: "rolls/YYYY/MM/<uuid>.<ext>". Rejecting anything else stops
// a client pointing a roll at an arbitrary object in the bucket.
const objectPath = z
  .string()
  .regex(/^rolls\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i, "Not a valid upload path");

// The registration form fills every one of these, so all of them are required here. Only
// fields the form does not ask for stay optional.
export const createRollSchema = z.object({
  roll_number: z.string().trim().min(1, "Roll number is required"),
  // Royal Touche's code for the base paper (e.g. "639"), read off the label alongside the
  // roll number. Not minted here: it names the paper, so every roll of that paper carries
  // the same one — which also means a phone can fill it in with no signal.
  //
  // Optional for now, at the client's request, while the mobile app is being wired up. The
  // catalogue also lists Delta-range papers that have no RT code at all, so a roll made
  // from one has nothing to put here. A roll without it cannot be traced back to its paper
  // — worth making required again once registration reliably supplies it.
  royal_touche_code: z.string().trim().min(1).optional(),
  material_id: objectId.describe("Material"),
  vendor_id: objectId.describe("Vendor"),
  weight: z.number({ required_error: "Weight is required" }).positive("Weight must be greater than 0"),
  gsm: z.number({ required_error: "GSM is required" }).positive("GSM must be greater than 0"),
  width: z.number({ required_error: "Width is required" }).positive("Width must be greater than 0"),
  location: z.string().trim().min(1, "Location is required"),
  date: z
    .string({ required_error: "Date is required" })
    .datetime({ offset: true })
    .or(z.string().date()),
  // A code from the remark master, when the roll is worth flagging — a shade variation,
  // a misprint. Not validated against the master: the phone picks it from its cached copy
  // and `location` is stored the same way, as the code rather than a reference.
  remark_code: z.string().trim().min(1).optional(),
  // The note itself, when the code alone doesn't say enough. Both are optional and
  // independent — a roll can carry either, both, or neither.
  remarks: z.string().trim().optional(),
  // Not on the registration form: set by later flows, or read off the label when present.
  batch_no: z.string().trim().optional(),
  remaining_weight: z.number().nonnegative().optional(),
  quantity: z.number().positive("Quantity must be greater than 0").optional(),
  unit: z.string().trim().min(1).optional(),
  status: z.enum(ROLL_STATUSES).optional(),
  // GCS object paths returned by POST /media/upload — not URLs, and not raw files.
  tag_photo_path: objectPath.optional(),
  stitched_barcode_photo_path: objectPath.optional(),
  side1_photo_path: objectPath.optional(),
  side2_photo_path: objectPath.optional(),
  // Offline flush: the device's own id for this queued registration. Sending it makes the
  // create idempotent — retry it and you get the same roll, not a second one. A UUID
  // because the device has to mint it with no server round trip and no chance of
  // colliding with another phone's.
  client_id: z.string().uuid("client_id must be a UUID").optional(),
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
  })
  // Inherited from the create schema by .partial(), and refused here: client_id is the
  // record of which queued write produced this roll. Rewriting it would free a spent id
  // to create a second roll, which is the exact thing it exists to prevent.
  .refine((v) => v.client_id === undefined, {
    message: "client_id is set when the roll is created and cannot be changed",
    path: ["client_id"],
  });

export const listRollsQuerySchema = z.object({
  q: z.string().trim().optional(),
  material_id: objectId.optional(),
  vendor_id: objectId.optional(),
  status: z.enum(ROLL_STATUSES).optional(),
  location: z.string().trim().optional(),
  // Delta pull: only rolls touched since the device's last checkpoint. Switches the sort
  // to updatedAt ascending so the client can page through the backlog oldest-first and
  // save the last updatedAt it saw as the next checkpoint.
  updated_after: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});
