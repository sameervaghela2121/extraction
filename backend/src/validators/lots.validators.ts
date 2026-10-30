import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid id");
// Only paths this API minted for a challan photo: "lots/YYYY/MM/<uuid>.<ext>".
const lotPhotoPath = z
  .string()
  .regex(/^lots\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i, "Not a valid challan photo path");

export const createLotSchema = z.object({
  challan_no: z.string().trim().min(1, "Challan number is required").max(100),
  challan_photo_path: lotPhotoPath.optional(),
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
