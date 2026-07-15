import { Types, type HydratedDocument } from "mongoose";
import { DocumentModel, type DocumentSource, type IDocument } from "../models/Document.model";
import { ActivityLog } from "../models/ActivityLog.model";
import { SharedFile } from "../models/SharedFiles.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { ApiError } from "../utils/ApiError";
import {
  confidenceFromValidation,
  extractedFields,
  extractedItems,
  invoiceAmount,
  invoiceVendor,
} from "../utils/invoiceMapping";
import type { AuthPayload } from "../types/express";

const SOURCE_LABEL: Record<DocumentSource, string> = {
  upload: "upload",
  scan: "mobile scan",
  email: "email",
};

async function logActivity(
  documentId: Types.ObjectId,
  actor: string,
  action: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await ActivityLog.create({ documentId, actor, action, timestamp: new Date(), meta });
}

/** Wait briefly for the Python service to register Files docs under a job_id (they're written synchronously in /extract). */
async function findFilesForJob(jobId: string, expected: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const files = await SharedFile.find({ job_id: jobId }).sort({ idx: 1 });
    if (files.length >= expected) return files;
    await new Promise((r) => setTimeout(r, 300));
  }
  return SharedFile.find({ job_id: jobId }).sort({ idx: 1 });
}

export const documentsService = {
  /**
   * Shared intake path used by upload and scan-complete: given a jobId returned by
   * the extraction service, create one portal Document per registered file.
   */
  async createFromExtraction(
    jobId: string,
    ownerId: string,
    source: DocumentSource,
    fileCount: number,
  ): Promise<IDocument[]> {
    const files = await findFilesForJob(jobId, fileCount);
    if (files.length === 0) {
      throw new ApiError(502, "Extraction service did not register any files for this job");
    }
    const created: IDocument[] = [];
    for (const file of files) {
      const doc = await DocumentModel.create({
        fileId: file._id,
        jobId,
        title: file.title || file.filename || "Untitled document",
        status: "pending",
        source,
        ownerId: new Types.ObjectId(ownerId),
        uploadedAt: new Date(),
      });
      await logActivity(doc._id, "System", "Data extraction requested");
      await logActivity(doc._id, "You", `Uploaded via ${SOURCE_LABEL[source]}`);
      created.push(doc);
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
    // Staff only see their own documents; admins see all.
    if (auth.role !== "admin") filter.ownerId = new Types.ObjectId(auth.userId);

    if (opts.status) {
      filter.status = opts.status;
    } else if (!opts.showArchived) {
      filter.status = { $ne: "archived" };
    }
    if (opts.search) {
      filter.title = { $regex: opts.search, $options: "i" };
    }

    const sortField = opts.sort === "date" ? "uploadedAt" : opts.sort === "title" ? "title" : "uploadedAt";
    const sortDir = opts.order === "asc" ? 1 : -1;

    const [docs, total] = await Promise.all([
      DocumentModel.find(filter)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("ownerId", "name email")
        .lean(),
      DocumentModel.countDocuments(filter),
    ]);

    // Join each document's first extracted invoice for amount/vendor/confidence display,
    // and its Files record for the live extraction-progress status (separate from the
    // portal's own review-workflow `status` field).
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

  async getOwnedOrAdmin(id: string, auth: AuthPayload): Promise<HydratedDocument<IDocument>> {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid document id");
    const doc = await DocumentModel.findById(id);
    if (!doc) throw ApiError.notFound("Document not found");
    if (auth.role !== "admin" && doc.ownerId.toString() !== auth.userId) {
      throw ApiError.forbidden("You do not have access to this document");
    }
    return doc;
  },

  async detail(id: string, auth: AuthPayload) {
    const doc = await this.getOwnedOrAdmin(id, auth);
    // One uploaded file can contain multiple invoices back-to-back — the extraction
    // service writes one Invoice record per invoice it finds, all sharing this file_id.
    // Sort by page so multi-invoice documents render in the same order as the PDF.
    const [file, invoices, activity] = await Promise.all([
      SharedFile.findById(doc.fileId).lean(),
      SharedInvoice.find({ file_id: doc.fileId }).sort({ page: 1 }).lean(),
      ActivityLog.find({ documentId: doc._id }).sort({ timestamp: 1 }).lean(),
    ]);

    return {
      id: doc._id.toString(),
      title: doc.title,
      status: doc.status,
      source: doc.source,
      uploadedAt: doc.uploadedAt,
      verifiedAt: doc.verifiedAt,
      fileId: doc.fileId.toString(),
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
    const doc = await this.getOwnedOrAdmin(id, auth);
    if (!Types.ObjectId.isValid(invoiceId)) throw ApiError.badRequest("Invalid invoice id");
    const invoice = await SharedInvoice.findById(invoiceId);
    // Must actually belong to this document — otherwise the id could target any invoice.
    if (!invoice || invoice.file_id?.toString() !== doc.fileId.toString()) {
      throw ApiError.notFound("No extracted data found for this document");
    }

    const known = new Set(Object.keys(invoice.toObject()));
    for (const [key, value] of Object.entries(updates)) {
      if (known.has(key) && key !== "other_fields") {
        invoice.set(key, value);
      } else {
        // Unknown key → store under other_fields so it survives round-trips.
        invoice.set(`other_fields.${key}`, value);
      }
    }
    invoice.set("editedBy", new Types.ObjectId(auth.userId));
    invoice.set("editedAt", new Date());
    await invoice.save();

    await logActivity(doc._id, auth.name, "Edited extracted fields", { keys: Object.keys(updates) });
    return this.detail(id, auth);
  },

  async transition(
    id: string,
    auth: AuthPayload,
    action: "verify" | "unverify" | "archive" | "restore",
  ) {
    const doc = await this.getOwnedOrAdmin(id, auth);
    switch (action) {
      case "verify":
        doc.status = "verified";
        doc.verifiedAt = new Date();
        doc.verifiedBy = new Types.ObjectId(auth.userId);
        await logActivity(doc._id, auth.name, "Approved & verified");
        break;
      case "unverify":
        doc.status = "pending";
        await logActivity(doc._id, auth.name, "Marked as pending");
        break;
      case "archive":
        doc.status = "archived";
        await logActivity(doc._id, auth.name, "Archived");
        break;
      case "restore":
        doc.status = "pending";
        await logActivity(doc._id, auth.name, "Restored from archive");
        break;
    }
    await doc.save();
    return { id: doc._id.toString(), status: doc.status };
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
        // Skip documents the user can't touch; report the rest.
      }
    }
    return { updated: results.length, results };
  },

  async activity(id: string, auth: AuthPayload) {
    const doc = await this.getOwnedOrAdmin(id, auth);
    const activity = await ActivityLog.find({ documentId: doc._id }).sort({ timestamp: 1 }).lean();
    return activity.map((a) => ({ actor: a.actor, action: a.action, timestamp: a.timestamp }));
  },
};
