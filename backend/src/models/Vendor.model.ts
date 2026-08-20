import { Schema, model, Types } from "mongoose";

export const VENDOR_STATUSES = ["active", "inactive"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export interface IVendor {
  _id: Types.ObjectId;
  vendor_code: string;
  name: string;
  contact?: {
    person?: string;
    phone?: string;
    email?: string;
  };
  address?: string;
  gst_number?: string;
  status: VendorStatus;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<IVendor>(
  {
    // Short stable handle. Renaming a vendor must not break what referenced it.
    vendor_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    contact: {
      person: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true },
    },
    address: { type: String, trim: true },
    gst_number: { type: String, uppercase: true, trim: true },
    status: { type: String, enum: [...VENDOR_STATUSES], default: "active" },
  },
  { timestamps: true },
);

export const Vendor = model<IVendor>("Vendor", vendorSchema);
