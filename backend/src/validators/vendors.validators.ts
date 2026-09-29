import { z } from "zod";
import { MASTER_STATUSES } from "../models/masterStatus";
import { masterSearchSchema, searchSchema } from "./search.validators";

const contactSchema = z.object({
  person: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().email().optional(),
});

// One row of the Royal Touche paper-codes sheet. royal_touche_code is what ends up on a
// roll; the rest is what the operator reads to recognise the paper.
export const basePaperSchema = z
  .object({
    royal_touche_code: z.string().trim().optional(),
    delta_code: z.string().trim().optional(),
    is_common: z.boolean().optional(),
    supplier_code_number: z.string().trim().optional(),
    found_in: z.string().trim().optional(),
  })
  // A Delta-range paper has no RT code, and that is allowed — but a paper with neither
  // code identifies nothing and could never be picked.
  .refine((p) => Boolean(p.royal_touche_code || p.delta_code), {
    message: "A paper needs at least a royal_touche_code or a delta_code",
    path: ["royal_touche_code"],
  });

export const createVendorSchema = z.object({
  vendor_code: z.string().trim().min(1, "Vendor code is required"),
  name: z.string().trim().min(1, "Name is required"),
  papers: z.array(basePaperSchema).optional(),
  contact: contactSchema.optional(),
  address: z.string().trim().optional(),
  gst_number: z.string().trim().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

export const updateVendorSchema = createVendorSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listVendorsQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

/** One page of the admin panel's vendor list — see search.validators.ts. */
export const searchVendorsSchema = masterSearchSchema(["name", "vendor_code"]);

/** One page of the paper-codes screen: every vendor's papers, one row per paper. */
export const searchPapersSchema = searchSchema(["vendor", "royal_touche_code", "delta_code", "supplier_code_number"]);
