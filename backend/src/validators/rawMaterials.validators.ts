import { z } from "zod";
import { MASTER_STATUSES } from "../models/masterStatus";
import { masterSearchSchema } from "./search.validators";

export const createRawMaterialSchema = z.object({
  material_code: z.string().trim().min(1, "Material code is required"),
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().optional(),
  gsm: z.number().nonnegative().optional(),
  width_mm: z.number().nonnegative().optional(),
  unit: z.string().trim().min(1).optional(),
  reorder_level: z.number().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

export const updateRawMaterialSchema = createRawMaterialSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listRawMaterialsQuerySchema = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

/** Every material's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderRawMaterialsSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one material id"),
  // Set when the admin panel drags within one page of the paged list: where this page's
  // first row sits in the full order. Absent = `ids` is the whole list (the original contract).
  offset: z.number().int().nonnegative().optional(),
});

/** One page of the admin panel's list — see search.validators.ts. */
export const searchRawMaterialsSchema = masterSearchSchema(["sort_order", "material_code", "name"]);
