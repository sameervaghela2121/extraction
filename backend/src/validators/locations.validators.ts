import { z } from "zod";
import { MASTER_STATUSES } from "../models/masterStatus";
import { masterSearchSchema } from "./search.validators";

export const createLocationSchema = z.object({
  location_code: z.string().trim().min(1, "Location code is required"),
  name: z.string().trim().min(1, "Name is required"),
  // Which building this bay is in, so a picker can group "Godown A side 1" and
  // "Godown A side 2" together without parsing the name.
  godown: z.string().trim().optional(),
  sort_order: z.number().int().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

export const updateLocationSchema = createLocationSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listLocationsQuerySchema = z.object({
  q: z.string().trim().optional(),
  godown: z.string().trim().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

/** Every location's id, in the new top-to-bottom order — see reorderDocs in utils/crud.ts. */
export const reorderLocationsSchema = z.object({
  ids: z.array(z.string()).min(1, "Provide at least one location id"),
  // Set when the admin panel drags within one page of the paged list: where this page's
  // first row sits in the full order. Absent = `ids` is the whole list (the original contract).
  offset: z.number().int().nonnegative().optional(),
});

/** One page of the admin panel's list — see search.validators.ts. */
export const searchLocationsSchema = masterSearchSchema(["sort_order", "location_code", "name"]);
