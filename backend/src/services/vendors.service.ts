import { type FilterQuery } from "mongoose";
import { Vendor, type IVendor, type VendorStatus } from "../models/Vendor.model";
import { escapeRegex, findOr404, ensureCodeFree, applyUpdates } from "../utils/crud";

type VendorInput = {
  vendor_code: string;
  name: string;
  contact?: { person?: string; phone?: string; email?: string };
  address?: string;
  gst_number?: string;
  status?: VendorStatus;
};

const PATCHABLE = ["name", "address", "gst_number", "status"] as const;
const CODE_TAKEN = "A vendor with this code already exists";

function toResponse(v: IVendor) {
  return {
    id: v._id.toString(),
    vendor_code: v.vendor_code,
    name: v.name,
    contact: v.contact ?? {},
    address: v.address,
    gst_number: v.gst_number,
    status: v.status,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export const vendorsService = {
  // No pagination: a vendor master is a few hundred rows at most, and every caller
  // (pickers, dropdowns) wants the whole list anyway.
  async list(query: { q?: string; status?: VendorStatus }) {
    const filter: FilterQuery<IVendor> = {};
    if (query.status) filter.status = query.status;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ name: rx }, { vendor_code: rx }, { gst_number: rx }];
    }
    const vendors = await Vendor.find(filter).sort({ name: 1 }).lean<IVendor[]>();
    return vendors.map(toResponse);
  },

  async get(id: string) {
    return toResponse(await findOr404(Vendor, id, "vendor"));
  },

  async create(input: VendorInput) {
    const code = input.vendor_code.toUpperCase();
    await ensureCodeFree(Vendor, "vendor_code", code, CODE_TAKEN);
    const vendor = await Vendor.create({ ...input, vendor_code: code });
    return toResponse(vendor);
  },

  async update(id: string, updates: Partial<VendorInput>) {
    const vendor = await findOr404(Vendor, id, "vendor");
    if (updates.vendor_code) {
      const code = updates.vendor_code.toUpperCase();
      if (code !== vendor.vendor_code) {
        await ensureCodeFree(Vendor, "vendor_code", code, CODE_TAKEN);
        vendor.vendor_code = code;
      }
    }
    // Merge rather than replace: a PATCH sending only contact.phone must not wipe
    // the person and email already stored alongside it.
    if (updates.contact) vendor.contact = { ...vendor.contact, ...updates.contact };
    applyUpdates(vendor, updates, PATCHABLE);
    await vendor.save();
    return toResponse(vendor);
  },

  // Soft delete, same as users: purchase history keeps pointing at the vendor,
  // so the row must survive — it just stops showing up as selectable.
  async remove(id: string) {
    const vendor = await findOr404(Vendor, id, "vendor");
    vendor.status = "inactive";
    await vendor.save();
    return { id: vendor._id.toString(), status: vendor.status };
  },
};
