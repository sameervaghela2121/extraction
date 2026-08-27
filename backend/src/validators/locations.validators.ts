import { z } from "zod";
import { LOCATION_STATUSES } from "../models/Location.model";

export const createLocationSchema = z.object({
  location_code: z.string().trim().min(1, "Location code is required"),
  name: z.string().trim().min(1, "Name is required"),
  // Which building this bay is in, so a picker can group "Godown A side 1" and
  // "Godown A side 2" together without parsing the name.
  godown: z.string().trim().optional(),
  sort_order: z.number().int().optional(),
  status: z.enum(LOCATION_STATUSES).optional(),
});

export const updateLocationSchema = createLocationSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listLocationsQuerySchema = z.object({
  q: z.string().trim().optional(),
  godown: z.string().trim().optional(),
  status: z.enum(LOCATION_STATUSES).optional(),
});
