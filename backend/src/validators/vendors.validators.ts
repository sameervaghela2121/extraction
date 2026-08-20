import { z } from "zod";
import { VENDOR_STATUSES } from "../models/Vendor.model";

const contactSchema = z.object({
  person: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().email().optional(),
});

export const createVendorSchema = z.object({
  vendor_code: z.string().trim().min(1, "Vendor code is required"),
  name: z.string().trim().min(1, "Name is required"),
  contact: contactSchema.optional(),
  address: z.string().trim().optional(),
  gst_number: z.string().trim().optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
});

export const updateVendorSchema = createVendorSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const listVendorsQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
});
