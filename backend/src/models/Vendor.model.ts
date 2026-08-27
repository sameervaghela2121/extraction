import { Schema, model, Types } from "mongoose";

export const VENDOR_STATUSES = ["active", "inactive"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/**
 * One base paper this supplier makes, straight off the Royal Touche paper-codes sheet.
 *
 * Embedded rather than a collection of its own: papers are only ever read through their
 * supplier ("pick AHLSTROM-E2P, then pick which of its papers"), they arrive as one file,
 * and the whole set is ~1,500 rows across all vendors. Embedding also means the mobile
 * app's existing vendor cache carries the papers with it, so an operator offline can fill
 * in royal_touche_code with no round trip.
 */
export interface IBasePaper {
  /**
   * Royal Touche's code for the paper, e.g. "639". Goes onto the roll as-is.
   *
   * Optional because the sheet also lists papers used only in the Delta range, which have
   * a delta_code and nothing else. They are kept so the master mirrors the sheet, but a
   * roll REQUIRES this field — so a registration picker must offer only papers that have
   * one. Every paper has at least one of the two codes.
   */
  royal_touche_code?: string;
  /** Delta's code for the same paper. The only code on a Delta-range paper. */
  delta_code?: string;
  /** True when the same paper serves RT and Delta under different design numbers. */
  is_common?: boolean;
  /** The supplier's own code and name, e.g. "AP 126640 SULAWEZI". */
  supplier_code_number?: string;
  /** Where the paper is used: "1.00mm", "1.25mm", "Delta", or a combination. */
  found_in?: string;
}

export interface IVendor {
  _id: Types.ObjectId;
  vendor_code: string;
  name: string;
  /** The supplier's base papers. Empty for a vendor that supplies something else. */
  papers?: IBasePaper[];
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
    papers: {
      type: [
        new Schema<IBasePaper>(
          {
            royal_touche_code: { type: String, uppercase: true, trim: true },
            delta_code: { type: String, uppercase: true, trim: true },
            is_common: { type: Boolean },
            supplier_code_number: { type: String, trim: true },
            found_in: { type: String, trim: true },
          },
          // No _id per paper: they are identified by their code, and an id nobody
          // references is just more bytes on every vendor fetch.
          { _id: false },
        ),
      ],
      default: undefined,
    },
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
