import { z } from "zod";

/**
 * A blank quantity must stay null rather than becoming 0 — "not counted" and
 * "zero received" are different facts on a goods receipt.
 */
const quantitySchema = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.union([z.number().finite(), z.null()]),
);

export const saveGrnSchema = z.object({
  documentId: z.string().min(1, "documentId is required"),
  invoiceId: z.string().min(1, "invoiceId is required"),
  invoiceNo: z.string().max(200).optional(),
  invoiceDate: z.string().max(100).optional(),
  items: z.array(
    z.object({
      description: z.string().max(2000).default(""),
      quantity: quantitySchema,
    }),
  ),
});

export const draftQuerySchema = z.object({
  // Sent as a single comma-separated value so one upload of several files is one request.
  documentIds: z.string().min(1, "documentIds is required"),
});
