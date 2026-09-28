import { z } from "zod";

export const createRawMaterialSchema = z.object({
  material_code: z.string().trim().min(1, "Material code is required"),
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().optional(),
  gsm: z.number().nonnegative().optional(),
  width_mm: z.number().nonnegative().optional(),
  unit: z.string().trim().min(1).optional(),
  reorder_level: z.number().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export const updateRawMaterialSchema = createRawMaterialSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listRawMaterialsQuerySchema = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  // Query strings are text, so "true"/"false" — z.coerce.boolean() would read "false" as true.
  is_active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/** Every material's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderRawMaterialsSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one material id"),
});
