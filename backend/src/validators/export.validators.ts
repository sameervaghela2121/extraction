import { z } from "zod";

export const generateExportSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  columns: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
    .optional(),
});
