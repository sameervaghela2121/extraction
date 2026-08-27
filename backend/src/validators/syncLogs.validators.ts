import { z } from "zod";

export const listSyncLogsQuerySchema = z.object({
  // Only the batches that had something go wrong — the usual reason for opening this.
  failed_only: z.coerce.boolean().optional(),
  status_code: z.coerce.number().int().optional(),
  // Chase one queued item across every attempt the device made.
  client_id: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
