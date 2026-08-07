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

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().max(200).optional(),
});

export const statusSchema = z.object({
  status: z.enum(["awaiting", "approved", "rejected"]),
});

/**
 * Editing an already-saved GRN's received quantity, from the list's inline dropdown.
 * Blank clears to an explicit 0 here — unlike `quantitySchema` above (used at initial
 * capture, where blank means "not yet counted"), a staffer correcting a saved GRN who
 * clears the box is confirming "zero arrived", not leaving it uncounted.
 */
const editableQuantitySchema = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? 0 : v),
  z.number().finite(),
);

export const updateQuantitiesSchema = z.object({
  quantities: z.array(editableQuantitySchema).min(1),
});

/**
 * Body for the public PATCH /api/public/grn/:id endpoint. No fixed enum — this field is
 * owned by whatever external system calls it, not this app's own workflow — just a
 * sanity length cap so an open, unauthenticated endpoint can't be used to stuff arbitrary
 * amounts of junk data into one field.
 */
export const updateGrnStatusSchema = z.object({
  grnStatus: z.string().trim().min(1, "grnStatus is required").max(200),
});
