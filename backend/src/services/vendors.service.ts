import { type FilterQuery } from "mongoose";
import { Vendor, type IVendor, type IBasePaper, type VendorStatus } from "../models/Vendor.model";
import { escapeRegex, findOr404, ensureCodeFree, applyUpdates } from "../utils/crud";
import { findReplay, isReplayCollision, resolveReplay } from "../utils/idempotency";

type VendorInput = {
  vendor_code: string;
  name: string;
  // A PATCH replaces the whole array rather than merging row by row: the papers sheet is
  // edited as a set in the master-data screen, and rows have no stable id to merge on.
  papers?: IBasePaper[];
  /** Offline flush: the device's id for this queued vendor. See create. */
  client_id?: string;
  contact?: { person?: string; phone?: string; email?: string };
  address?: string;
  gst_number?: string;
  status?: VendorStatus;
};

const PATCHABLE = ["name", "papers", "address", "gst_number", "status"] as const;
const CODE_TAKEN = "A vendor with this code already exists";

function toResponse(v: IVendor) {
  return {
    id: v._id.toString(),
    vendor_code: v.vendor_code,
    name: v.name,
    // The supplier's base papers, from the Royal Touche paper-codes sheet. Sent with the
    // list because that is how the app fills a roll's royal_touche_code offline: pick the
    // supplier, pick one of its papers. `[]` rather than undefined so a caller can map
    // over it without a guard.
    papers: v.papers ?? [],
    contact: v.contact ?? {},
    address: v.address,
    gst_number: v.gst_number,
    status: v.status,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/** What makes two paper rows the same paper. RT code first: it is the code that ends up on
 *  a roll. A Delta-range paper has no RT code, so it is keyed by its delta code instead. */
function paperKey(paper: IBasePaper): string {
  return (paper.royal_touche_code || `delta:${paper.delta_code}`).toUpperCase();
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
    // Before the vendor_code check, for the same reason rolls do it first: a phone
    // re-flushing a queued vendor whose response it never received must get that vendor
    // back, not "a vendor with this code already exists" — which is this very vendor, and
    // would wedge the device's queue on an item it can never drain.
    const replayed = await findReplay(Vendor, input.client_id);
    if (replayed) return toResponse(replayed);

    const code = input.vendor_code.toUpperCase();
    await ensureCodeFree(Vendor, "vendor_code", code, CODE_TAKEN);
    try {
      return toResponse(await Vendor.create({ ...input, vendor_code: code }));
    } catch (err) {
      // Two flushes of the same queued vendor raced. The winner's document answers both.
      if (input.client_id && isReplayCollision(err)) {
        return toResponse(await resolveReplay(Vendor, input.client_id, err));
      }
      throw err;
    }
  },

  /**
   * Add supplier codes to a vendor, merging by code rather than appending.
   *
   * Idempotent on purpose: this is what an offline device replays, and papers carry no id
   * of their own, so "already added" has to be decided from the content. A paper whose RT
   * code (or delta code, for a Delta-range paper) is already on the vendor updates that
   * row instead of adding a second one for the same paper.
   */
  async addPapers(id: string, papers: IBasePaper[]) {
    const vendor = await findOr404(Vendor, id, "vendor");
    const merged = [...(vendor.papers ?? [])];

    for (const paper of papers) {
      const key = paperKey(paper);
      const existing = merged.findIndex((p) => paperKey(p) === key);
      if (existing >= 0) merged[existing] = { ...merged[existing], ...paper };
      else merged.push(paper);
    }

    vendor.papers = merged;
    await vendor.save();
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
