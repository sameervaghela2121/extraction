import { Schema, model, Types } from "mongoose";
import { MASTER_STATUSES, type MasterStatus } from "./masterStatus";

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
   * a delta_code and nothing else. Every paper has at least one of the two codes.
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

/**
 * What makes two paper rows the same paper. RT code first: it is the code that ends up on a
 * roll's label. A Delta-range paper has no RT code, so it is keyed by its delta code instead.
 */
export function paperKey(paper: Pick<IBasePaper, "royal_touche_code" | "delta_code">): string {
  return (paper.royal_touche_code || `delta:${paper.delta_code ?? ""}`).toUpperCase();
}

/** Shared with MaterialRoll, which keeps its own copy of the paper(s) it was booked against. */
export const basePaperSchema = new Schema<IBasePaper>(
  {
    royal_touche_code: { type: String, uppercase: true, trim: true },
    delta_code: { type: String, uppercase: true, trim: true },
    is_common: { type: Boolean },
    supplier_code_number: { type: String, trim: true },
    found_in: { type: String, trim: true },
  },
  // No _id per paper: they are identified by their code, and an id nobody references is
  // just more bytes on every vendor fetch.
  { _id: false },
);

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
  status: MasterStatus;
  /** Minted on the device when a vendor is added offline, so a flush that retries after a
   *  lost response gets this vendor back instead of creating a second one. Absent on
   *  vendors created from the web portal, which never queues. */
  client_id?: string;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<IVendor>(
  {
    // Short stable handle. Renaming a vendor must not break what referenced it.
    vendor_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    papers: { type: [basePaperSchema], default: undefined },
    contact: {
      person: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true },
    },
    address: { type: String, trim: true },
    gst_number: { type: String, uppercase: true, trim: true },
    status: { type: String, enum: [...MASTER_STATUSES], default: "active", required: true, index: true },
    client_id: { type: String, trim: true },
  },
  { timestamps: true },
);

// The replay guard, same shape as the roll's: sparse because every vendor added before
// this field existed has no client_id, and a plain unique index would read them all as
// the same null and refuse to build.
vendorSchema.index({ client_id: 1 }, { unique: true, sparse: true });

export const Vendor = model<IVendor>("Vendor", vendorSchema);
