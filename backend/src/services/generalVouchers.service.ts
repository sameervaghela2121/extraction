import { Types, type HydratedDocument } from "mongoose";
import { GeneralVoucher, type IGeneralVoucher } from "../models/GeneralVoucher.model";
import type { DocumentSource } from "../models/Document.model";
import { ActivityLog } from "../models/ActivityLog.model";
import { SharedFile } from "../models/SharedFiles.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { ApiError } from "../utils/ApiError";
import { findFilesForJob } from "../utils/findFilesForJob";
import {
  confidenceFromValidation,
  extractedFields,
  extractedItems,
  invoiceAmount,
  invoiceVendor,
  NON_FIELD_KEYS,
} from "../utils/invoiceMapping";
import type { AuthPayload } from "../types/express";

const SOURCE_LABEL: Record<DocumentSource, string> = {
  upload: "upload",
  scan: "mobile scan",
  email: "email",
};

async function logActivity(
  voucherId: Types.ObjectId,
  actor: string,
  action: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await ActivityLog.create({ documentId: voucherId, actor, action, timestamp: new Date(), meta });
}

export const generalVouchersService = {
  /** Same intake path as Documents: one General Voucher row per registered file, created
   *  immediately after upload — extraction runs in the background and is polled separately. */
  async createFromExtraction(
    jobId: string,
    ownerId: string,
    source: DocumentSource,
    fileCount: number,
  ): Promise<IGeneralVoucher[]> {
    const files = await findFilesForJob(jobId, fileCount);
    if (files.length === 0) {
      throw new ApiError(502, "Extraction service did not register any files for this job");
    }
    const created: IGeneralVoucher[] = [];
    for (const file of files) {
      const voucher = await GeneralVoucher.create({
        fileId: file._id,
        jobId,
        title: file.title || file.filename || "Untitled voucher",
        status: "pending",
        source,
        ownerId: new Types.ObjectId(ownerId),
        uploadedAt: new Date(),
      });
      await logActivity(voucher._id, "System", "Data extraction requested");
      await logActivity(voucher._id, "You", `Uploaded via ${SOURCE_LABEL[source]}`);
      created.push(voucher);
    }
    return created;
  },

  async list(
    auth: AuthPayload,
    opts: {
      search?: string;
      status?: string;
      showArchived?: boolean;
      sort?: string;
      order?: "asc" | "desc";
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));

    const filter: Record<string, unknown> = {};
    // Staff only see their own vouchers; admins see all.
    if (auth.role !== "admin") filter.ownerId = new Types.ObjectId(auth.userId);

    if (opts.status) {
      filter.status = opts.status;
    } else if (!opts.showArchived) {
      filter.status = { $ne: "archived" };
    }
    if (opts.search) {
      // Escaped before it reaches RegExp — an unescaped search term (regex metacharacters,
      // or a pathological pattern like `(a+)+`) could otherwise throw or hang the query.
      const rx = new RegExp(opts.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.title = rx;
    }

    const sortField = opts.sort === "date" ? "uploadedAt" : opts.sort === "title" ? "title" : "uploadedAt";
    const sortDir = opts.order === "asc" ? 1 : -1;

    const [docs, total] = await Promise.all([
      GeneralVoucher.find(filter)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("ownerId", "name email")
        .lean(),
      GeneralVoucher.countDocuments(filter),
    ]);

    // Join each voucher's first extracted record for amount/vendor/confidence display, and
    // its Files record for the live extraction-progress status.
    const fileIds = docs.map((d) => d.fileId);
    const [invoices, files] = await Promise.all([
      SharedInvoice.find({ file_id: { $in: fileIds } }).lean(),
      SharedFile.find({ _id: { $in: fileIds } }).select("status").lean(),
    ]);
    const invoiceByFile = new Map<string, ISharedInvoice>();
    for (const inv of invoices) {
      const key = inv.file_id?.toString();
      if (key && !invoiceByFile.has(key)) invoiceByFile.set(key, inv as ISharedInvoice);
    }
    const statusByFile = new Map<string, string>();
    for (const f of files) statusByFile.set(f._id.toString(), f.status);

    const items = docs.map((d) => {
      const inv = invoiceByFile.get(d.fileId.toString());
      const owner = d.ownerId as unknown as { name?: string; email?: string } | null;
      return {
        id: d._id.toString(),
        title: d.title,
        status: d.status,
        source: d.source,
        uploadedAt: d.uploadedAt,
        owner: owner?.name ?? "Unknown",
        amount: invoiceAmount(inv),
        vendor: invoiceVendor(inv),
        confidence: confidenceFromValidation(inv?.validation),
        extractionStatus: statusByFile.get(d.fileId.toString()) ?? "unknown",
      };
    });

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },

  async getOwnedOrAdmin(id: string, auth: AuthPayload): Promise<HydratedDocument<IGeneralVoucher>> {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid voucher id");
    const voucher = await GeneralVoucher.findById(id);
    if (!voucher) throw ApiError.notFound("General voucher not found");
    if (auth.role !== "admin" && voucher.ownerId.toString() !== auth.userId) {
      throw ApiError.forbidden("You do not have access to this voucher");
    }
    return voucher;
  },

  async detail(id: string, auth: AuthPayload) {
    const voucher = await this.getOwnedOrAdmin(id, auth);
    const [file, invoices, activity] = await Promise.all([
      SharedFile.findById(voucher.fileId).lean(),
      SharedInvoice.find({ file_id: voucher.fileId }).sort({ page: 1 }).lean(),
      ActivityLog.find({ documentId: voucher._id }).sort({ timestamp: 1 }).lean(),
    ]);

    return {
      id: voucher._id.toString(),
      title: voucher.title,
      status: voucher.status,
      source: voucher.source,
      uploadedAt: voucher.uploadedAt,
      verifiedAt: voucher.verifiedAt,
      fileId: voucher.fileId.toString(),
      extractionStatus: file?.status ?? "unknown",
      extractionError: file?.error,
      invoices: invoices.map((invoice) => ({
        invoiceId: invoice._id.toString(),
        validation: invoice.validation,
        confidence: confidenceFromValidation(invoice.validation),
        fields: extractedFields(invoice as ISharedInvoice),
        items: extractedItems(invoice as ISharedInvoice),
      })),
      activity: activity.map((a) => ({
        actor: a.actor,
        action: a.action,
        timestamp: a.timestamp,
      })),
    };
  },

  async updateFields(
    id: string,
    invoiceId: string,
    updates: Record<string, string | number>,
    auth: AuthPayload,
  ) {
    const voucher = await this.getOwnedOrAdmin(id, auth);
    if (!Types.ObjectId.isValid(invoiceId)) throw ApiError.badRequest("Invalid invoice id");
    const invoice = await SharedInvoice.findById(invoiceId);
    if (!invoice || invoice.file_id?.toString() !== voucher.fileId.toString()) {
      throw ApiError.notFound("No extracted data found for this voucher");
    }

    const known = new Set(Object.keys(invoice.toObject()));
    for (const [key, value] of Object.entries(updates)) {
      // Structural/system fields (file_id, _id, editedBy, ...) are never client-settable —
      // otherwise a caller could re-parent this invoice onto a different document/owner
      // just by including e.g. "file_id" in the update payload.
      if (NON_FIELD_KEYS.has(key)) continue;
      if (known.has(key) && key !== "other_fields") {
        invoice.set(key, value);
      } else {
        invoice.set(`other_fields.${key}`, value);
      }
    }
    invoice.set("editedBy", new Types.ObjectId(auth.userId));
    invoice.set("editedAt", new Date());
    await invoice.save();

    await logActivity(voucher._id, auth.name, "Edited extracted fields", { keys: Object.keys(updates) });
    return this.detail(id, auth);
  },

  async transition(
    id: string,
    auth: AuthPayload,
    action: "verify" | "unverify" | "archive" | "restore",
  ) {
    const voucher = await this.getOwnedOrAdmin(id, auth);
    switch (action) {
      case "verify":
        voucher.status = "verified";
        voucher.verifiedAt = new Date();
        voucher.verifiedBy = new Types.ObjectId(auth.userId);
        await logActivity(voucher._id, auth.name, "Approved & verified");
        break;
      case "unverify":
        voucher.status = "pending";
        await logActivity(voucher._id, auth.name, "Marked as pending");
        break;
      case "archive":
        voucher.status = "archived";
        await logActivity(voucher._id, auth.name, "Archived");
        break;
      case "restore":
        voucher.status = "pending";
        await logActivity(voucher._id, auth.name, "Restored from archive");
        break;
    }
    await voucher.save();
    return { id: voucher._id.toString(), status: voucher.status };
  },

  async bulkTransition(
    ids: string[],
    auth: AuthPayload,
    action: "verify" | "unverify" | "archive",
  ) {
    const results = [];
    for (const id of ids) {
      try {
        results.push(await this.transition(id, auth, action));
      } catch {
        // Skip vouchers the user can't touch; report the rest.
      }
    }
    return { updated: results.length, results };
  },

  async activity(id: string, auth: AuthPayload) {
    const voucher = await this.getOwnedOrAdmin(id, auth);
    const activity = await ActivityLog.find({ documentId: voucher._id }).sort({ timestamp: 1 }).lean();
    return activity.map((a) => ({ actor: a.actor, action: a.action, timestamp: a.timestamp }));
  },
};
