import { z } from "zod";

export const toggleFieldSchema = z.object({
  enabled: z.boolean(),
});

export const addCustomFieldSchema = z.object({
  key: z.string().min(1).optional(),
  label: z.string().min(1, "Column title is required"),
  description: z.string().optional(),
});
