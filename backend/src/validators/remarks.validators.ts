import { z } from "zod";
import { REMARK_STATUSES } from "../models/Remark.model";

export const createRemarkSchema = z.object({
  remark_code: z.string().trim().min(1, "Remark code is required"),
  label: z.string().trim().min(1, "Label is required"),
  sort_order: z.number().int().optional(),
  status: z.enum(REMARK_STATUSES).optional(),
});

export const updateRemarkSchema = createRemarkSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listRemarksQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(REMARK_STATUSES).optional(),
});

/** Every remark's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderRemarksSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one remark id"),
});
