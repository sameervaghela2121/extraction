import { z } from "zod";

export const updateFieldsSchema = z.object({
  fields: z.record(z.string(), z.union([z.string(), z.number()])),
});

export const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Provide at least one document id"),
});
