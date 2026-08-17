import { z } from "zod";

export const lookupQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
});

/**
 * Name only — the code is minted by the server. An upper bound because this string ends up
 * on reports and a paste accident should not become a customer record.
 */
export const createClientSchema = z.object({
  name: z.string().trim().min(2, "Client name is too short").max(120),
});

export const batchQuerySchema = lookupQuerySchema.extend({
  supplierId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid supplier id")
    .optional(),
});
