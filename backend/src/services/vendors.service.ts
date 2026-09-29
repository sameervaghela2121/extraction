import { type FilterQuery } from "mongoose";
import { Vendor, paperKey, type IVendor, type IBasePaper } from "../models/Vendor.model";
import type { MasterStatus } from "../models/masterStatus";
import {
  escapeRegex,
  findOr404,
  ensureCodeFree,
  applyUpdates,
  directed,
  paginated,
  pagedAggregate,
  type SortSpec,
} from "../utils/crud";
import type { z } from "zod";
import type { searchPapersSchema, searchVendorsSchema } from "../validators/vendors.validators";
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
  status?: MasterStatus;
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

/** A vendor as a row of the admin panel's vendor table: no papers. They have their own
 *  screen (the papers search), and a page of vendors would otherwise carry hundreds. */
function toRowResponse(v: Omit<IVendor, "papers">) {
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

/** Shared by the GET list (the app's picker) and the admin panel's paged search. */
function filterOf(query: { q?: string; status?: MasterStatus }): FilterQuery<IVendor> {
  const filter: FilterQuery<IVendor> = {};
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ name: rx }, { vendor_code: rx }, { gst_number: rx }];
  }
  return filter;
}

const SORTS: Record<NonNullable<z.infer<typeof searchVendorsSchema>["sort"]>, SortSpec> = {
  name: { name: 1 },
  vendor_code: { vendor_code: 1 },
};

/** The paper-codes screen's columns. "vendor" keeps each supplier's papers in sheet order. */
const PAPER_SORTS: Record<NonNullable<z.infer<typeof searchPapersSchema>["sort"]>, SortSpec> = {
  vendor: { "vendor.name": 1, index: 1 },
  royal_touche_code: { "paper.royal_touche_code": 1 },
  delta_code: { "paper.delta_code": 1 },
  supplier_code_number: { "paper.supplier_code_number": 1 },
};

type PaperRow = {
  vendor: { _id: IVendor["_id"]; name: string; vendor_code: string };
  index: number;
  paper: IBasePaper;
};

export const vendorsService = {
  // No pagination: a vendor master is a few hundred rows at most, and every caller
  // (pickers, dropdowns) wants the whole list anyway.
  async list(query: { q?: string; status?: MasterStatus }) {
    const filter = filterOf(query);
    const vendors = await Vendor.find(filter).sort({ name: 1 }).lean<IVendor[]>();
    return vendors.map(toResponse);
  },

  /** One page for the admin panel: filtered, sorted and paged in the database. */
  async search(input: z.infer<typeof searchVendorsSchema>) {
    const { items, total } = await pagedAggregate<Omit<IVendor, "papers">>(
      Vendor,
      [{ $match: filterOf(input) }],
      {
        sort: directed(SORTS[input.sort ?? "name"], input.order),
        page: input.page,
        pageSize: input.pageSize,
        // Dropped in the database, so the papers never leave MongoDB.
        project: { papers: 0 },
      },
    );
    return paginated(items.map(toRowResponse), total, input.page, input.pageSize);
  },

  /**
   * One page of every vendor's papers, one row per paper — the paper-codes screen.
   *
   * Papers are embedded in their vendor and carry no id, so a row is addressed by its
   * vendor plus its position in that vendor's array (`index`), which is what an edit
   * PATCHes back. Unwound in the database so the page never loads all ~1,500 papers.
   */
  async searchPapers(input: z.infer<typeof searchPapersSchema>) {
    const rx = input.q ? new RegExp(escapeRegex(input.q), "i") : undefined;
    const { items, total } = await pagedAggregate<PaperRow>(
      Vendor,
      [
        { $unwind: { path: "$papers", includeArrayIndex: "index" } },
        {
          $project: {
            _id: 0,
            vendor: { _id: "$_id", name: "$name", vendor_code: "$vendor_code" },
            index: 1,
            paper: "$papers",
          },
        },
        ...(rx
          ? [
              {
                $match: {
                  $or: [
                    { "paper.royal_touche_code": rx },
                    { "paper.delta_code": rx },
                    { "paper.supplier_code_number": rx },
                    { "vendor.name": rx },
                  ],
                },
              },
            ]
          : []),
      ],
      {
        sort: directed(PAPER_SORTS[input.sort ?? "vendor"], input.order),
        page: input.page,
        pageSize: input.pageSize,
      },
    );
    return paginated(
      items.map((r) => ({
        vendor: { id: r.vendor._id.toString(), name: r.vendor.name, vendor_code: r.vendor.vendor_code },
        index: r.index,
        paper: r.paper,
      })),
      total,
      input.page,
      input.pageSize,
    );
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
