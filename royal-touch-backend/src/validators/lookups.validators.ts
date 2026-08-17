import { z } from "zod";

export const lookupQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
});

export const batchQuerySchema = lookupQuerySchema.extend({
  supplierId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid supplier id")
    .optional(),
});
