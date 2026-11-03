import { z } from "zod";
import { LOT_DOCUMENT_TYPES } from "../models/Lot.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
// Only paths this API minted for a lot's document photo: "lots/YYYY/MM/<uuid>.<ext>".
const lotPhotoPath = z
  .string()
  .regex(/^lots\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i, "Not a valid document photo path");

export const createLotSchema = z.object({
  document_type: z.enum(LOT_DOCUMENT_TYPES, { message: "Pick challan or invoice" }),
  document_no: z.string().trim().min(1, "Challan or invoice number is required").max(100),
  document_photo_path: lotPhotoPath.optional(),
  client_id: z.string().uuid("client_id must be a UUID").optional(),
});

export const listLotsQuerySchema = z
  .object({
    q: z.string().trim().optional(),
    // Delta pull — same contract as the roll list: (updatedAt, _id) after the checkpoint.
    updated_after: z.coerce.date().optional(),
    after_id: objectId.optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(200).optional(),
  })
  .refine((v) => !v.after_id || v.updated_after, {
    message: "after_id needs updated_after",
    path: ["after_id"],
  });

export type CreateLotInput = z.infer<typeof createLotSchema>;
