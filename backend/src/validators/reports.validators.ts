import { z } from "zod";

/** A period of whole India-time days, both ends included. */
export const consumptionReportQuerySchema = z
  .object({
    from: z.string({ required_error: "From date is required" }).date("From must be YYYY-MM-DD"),
    to: z.string({ required_error: "To date is required" }).date("To must be YYYY-MM-DD"),
    group: z.enum(["material", "design"]).default("material"),
  })
  .refine((v) => v.from <= v.to, { message: "From must not be after to", path: ["from"] });

export const dailyRollReportQuerySchema = z.object({
  /** The business day to report on, in India time. */
  date: z.string({ required_error: "Date is required" }).date("Date must be YYYY-MM-DD"),
});
