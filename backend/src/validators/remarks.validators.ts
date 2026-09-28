import { z } from "zod";

export const createRemarkSchema = z.object({
  remark_code: z.string().trim().min(1, "Remark code is required"),
  label: z.string().trim().min(1, "Label is required"),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export const updateRemarkSchema = createRemarkSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listRemarksQuerySchema = z.object({
  q: z.string().trim().optional(),
  // Query strings are text, so "true"/"false" — z.coerce.boolean() would read "false" as true.
  is_active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/** Every remark's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderRemarksSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one remark id"),
});
