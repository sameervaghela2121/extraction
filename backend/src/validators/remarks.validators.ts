import { z } from "zod";
import { MASTER_STATUSES } from "../models/masterStatus";
import { masterSearchSchema } from "./search.validators";

export const createRemarkSchema = z.object({
  remark_code: z.string().trim().min(1, "Remark code is required"),
  label: z.string().trim().min(1, "Label is required"),
  sort_order: z.number().int().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

export const updateRemarkSchema = createRemarkSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listRemarksQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

/** Every remark's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderRemarksSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one remark id"),
  // Set when the admin panel drags within one page of the paged list: where this page's
  // first row sits in the full order. Absent = `ids` is the whole list (the original contract).
  offset: z.number().int().nonnegative().optional(),
});

/** One page of the admin panel's list — see search.validators.ts. */
export const searchRemarksSchema = masterSearchSchema(["sort_order", "remark_code", "label"]);
