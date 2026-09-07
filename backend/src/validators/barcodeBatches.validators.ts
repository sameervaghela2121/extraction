import { z } from "zod";

/** Same ceiling the panel enforces: one run is one print job, not a bulk import. */
export const MAX_BATCH_LABELS = 500;

export const createBarcodeBatchSchema = z
  .object({
    prefix: z.string().trim().max(12).optional().default(""),
    // Blank means "no date in the code" — the panel offers a date, it isn't mandatory.
    date: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Date must be YYYY-MM-DD")
      .optional()
      .default(""),
    from_number: z.number().int().min(0),
    to_number: z.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    if (v.to_number < v.from_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to_number"],
        message: "The end number is lower than the start number",
      });
      return;
    }
    const count = v.to_number - v.from_number + 1;
    if (count > MAX_BATCH_LABELS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to_number"],
        message: `That's ${count} labels — ${MAX_BATCH_LABELS} at a time is the limit`,
      });
    }
  });

export const listBarcodeBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
