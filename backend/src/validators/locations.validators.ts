import { z } from "zod";

export const createLocationSchema = z.object({
  location_code: z.string().trim().min(1, "Location code is required"),
  name: z.string().trim().min(1, "Name is required"),
  // Which building this bay is in, so a picker can group "Godown A side 1" and
  // "Godown A side 2" together without parsing the name.
  godown: z.string().trim().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export const updateLocationSchema = createLocationSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listLocationsQuerySchema = z.object({
  q: z.string().trim().optional(),
  godown: z.string().trim().optional(),
  // Query strings are text, so "true"/"false" — z.coerce.boolean() would read "false" as true.
  is_active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/** Every location's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderLocationsSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one location id"),
});
