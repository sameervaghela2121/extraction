import { z } from "zod";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export const listMaterialsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  // Capped: an unbounded limit lets one request pull the whole master list.
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const materialIdParamsSchema = z.object({
  // Rejected here rather than by Mongoose, so a malformed id is a 400 and not a 500.
  materialId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid material id"),
});
