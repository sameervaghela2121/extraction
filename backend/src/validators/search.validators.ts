import { z } from "zod";
import { MASTER_STATUSES } from "../models/masterStatus";

/** Rows per page when the caller doesn't say. Matches the admin panel's page size. */
export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Body of every `POST …/search` endpoint: one page of a list, filtered and sorted in the
 * database. `sort` is an allow-list per endpoint rather than any field name — a free-form
 * key would let a caller sort on an unindexed field and turn a page into a full scan.
 *
 * A POST, not a GET: the GET lists stay exactly as they are because the mobile app reads
 * them whole to fill its offline pickers, and paging them would break that.
 */
export function searchSchema<const K extends readonly [string, ...string[]]>(sortKeys: K) {
  return z.object({
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    q: z.string().trim().max(100).optional(),
    sort: z.enum(sortKeys).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  });
}

/** The same, plus the status filter every master has. */
export function masterSearchSchema<const K extends readonly [string, ...string[]]>(sortKeys: K) {
  return searchSchema(sortKeys).extend({ status: z.enum(MASTER_STATUSES).optional() });
}
