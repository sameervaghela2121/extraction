import { Types } from "mongoose";
import { Grn, type GrnStatus, type IGrnItem } from "../models/Grn.model";
import { SharedFile } from "../models/SharedFiles.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { documentsService } from "./documents.service";
import { ApiError } from "../utils/ApiError";
import { toDDMMYYYY } from "../utils/grnDate";
import type { AuthPayload } from "../types/express";

/**
 * Invoice -> GRN: a GRN only cares about what arrived, so everything except the invoice
 * identity and the line items' description/quantity is dropped here.
 *
 * The `description` / `qty` keys are fixed by EXTRACTION_PROMPT in
 * invoice-generator-backend/api/main.py ({description, hsn, qty, unit, rate, amount}).
 * If that prompt's item schema ever changes, this mapping has to change with it.
 */
function toGrnItems(invoice: ISharedInvoice): IGrnItem[] {
  const items = (invoice.items ?? []) as Array<Record<string, unknown>>;
  return items.map((item) => ({
    description: String(item.description ?? ""),
    quantity: toQuantity(item.qty),
  }));
}

/** A quantity is a number or nothing — never a silent 0, which would read as "none received". */
function toQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * GRN items only ever persist description/quantity (see `toGrnItems` above) — unit was
 * never part of what a GRN records, so it's read back for display from the `extracted`
 * snapshot's original item at the same position rather than stored on the GRN itself.
 * GRNs saved before `extracted` existed, or invoices Gemini didn't read a unit for,
 * simply come back with none.
 */
function unitOf(extractedItem: Record<string, unknown> | undefined): string | undefined {
  const raw = extractedItem?.unit;
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  return s || undefined;
}

const MAX_DOCUMENT_IDS = 20; // matches the upload middleware's file cap

export const grnService = {
  /**
   * Poll target for the GRN screen: extraction progress plus the lean invoice data, for
   * every document produced by one upload. Any already-saved GRN is merged in so a
   * reloaded draft shows the user's own numbers rather than the raw extraction.
   */
  async draft(documentIds: string[], auth: AuthPayload) {
    if (documentIds.length === 0) throw ApiError.badRequest("No documents requested");
    if (documentIds.length > MAX_DOCUMENT_IDS) {
      throw ApiError.badRequest(`At most ${MAX_DOCUMENT_IDS} documents can be requested at once`);
    }

    const documents = [];
    for (const documentId of documentIds) {
      // Reuses the portal's staff-sees-own / admin-sees-all rule; throws 403/404 itself.
      const doc = await documentsService.getOwnedOrAdmin(documentId, auth);

      const [file, invoices, saved] = await Promise.all([
        SharedFile.findById(doc.fileId).lean(),
        // Page order, so a multi-invoice PDF reads down the document the way the user sees it.
        SharedInvoice.find({ file_id: doc.fileId }).sort({ page: 1 }).lean(),
        Grn.find({ documentId: doc._id }).lean(),
      ]);

      const savedByInvoice = new Map(saved.map((g) => [g.invoiceId.toString(), g]));

      documents.push({
        documentId: doc._id.toString(),
        title: doc.title,
        extractionStatus: file?.status ?? "unknown",
        extractionError: file?.error,
        invoices: invoices
          // A failed file writes an error-only row with no invoice data — nothing to receive.
          .filter((invoice) => !invoice.error)
          .map((invoice) => {
            const existing = savedByInvoice.get(invoice._id.toString());
            return {
              invoiceId: invoice._id.toString(),
              invoiceNo: existing?.invoiceNo ?? invoice.invoice_no ?? "",
              // Normalised here, so the capture screen shows DD-MM-YYYY and therefore saves it —
              // new GRNs land in that shape without a migration.
              invoiceDate: toDDMMYYYY(existing?.invoiceDate ?? invoice.invoice_date),
              items: existing ? existing.items : toGrnItems(invoice as ISharedInvoice),
              saved: Boolean(existing),
            };
          }),
      });
    }

    return { documents };
  },

  /** Upsert one invoice's GRN. Upsert (not insert) so re-saving corrects rather than duplicates. */
  async save(
    input: {
      documentId: string;
      invoiceId: string;
      invoiceNo?: string;
      invoiceDate?: string;
      items: IGrnItem[];
    },
    auth: AuthPayload,
  ) {
    const doc = await documentsService.getOwnedOrAdmin(input.documentId, auth);
    if (!Types.ObjectId.isValid(input.invoiceId)) throw ApiError.badRequest("Invalid invoice id");

    const invoice = await SharedInvoice.findById(input.invoiceId).lean();
    // Must belong to this document — otherwise any invoice id could be attached to a
    // document the caller happens to own.
    if (!invoice || invoice.file_id?.toString() !== doc.fileId.toString()) {
      throw ApiError.notFound("No extracted invoice found for this document");
    }

    const grn = await Grn.findOneAndUpdate(
      { invoiceId: new Types.ObjectId(input.invoiceId) },
      {
        $set: {
          documentId: doc._id,
          fileId: doc.fileId,
          invoiceNo: input.invoiceNo ?? "",
          invoiceDate: input.invoiceDate ?? "",
          items: input.items,
          // Everything the extraction produced, not just the handful the screen shows.
          // `invoice` is already loaded above for the ownership guard, so this is free.
          // $set (not $setOnInsert) so GRNs saved before this field existed get backfilled
          // the next time they're saved.
          extracted: invoice,
        },
        $setOnInsert: { createdBy: new Types.ObjectId(auth.userId) },
      },
      { new: true, upsert: true },
    ).lean();

    return {
      id: grn!._id.toString(),
      invoiceId: input.invoiceId,
      invoiceNo: grn!.invoiceNo,
      invoiceDate: toDDMMYYYY(grn!.invoiceDate),
      items: grn!.items,
      saved: true,
    };
  },

  /** Every saved GRN, newest first. Staff see their own; admins see all. */
  async list(auth: AuthPayload, opts: { page?: number; pageSize?: number; search?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));

    const filter: Record<string, unknown> =
      auth.role === "admin" ? {} : { createdBy: new Types.ObjectId(auth.userId) };

    if (opts.search) {
      // Escaped before it reaches RegExp — an unescaped "(" or "*" typed into the search box
      // would otherwise throw, or force a pathological scan.
      const rx = new RegExp(opts.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      // Invoice number only — it is how a receipt is referenced on paper. A sibling key of
      // `createdBy`, so top-level AND keeps staff scoping intact.
      filter.invoiceNo = rx;
    }

    const [grns, total] = await Promise.all([
      Grn.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        // `extracted` is the full invoice snapshot — never send it to a list screen.
        .select("-extracted")
        .populate("createdBy", "name")
        .lean(),
      Grn.countDocuments(filter),
    ]);

    return {
      items: grns.map((g) => ({
        id: g._id.toString(),
        invoiceNo: g.invoiceNo,
        invoiceDate: toDDMMYYYY(g.invoiceDate),
        itemCount: g.items.length,
        createdBy: (g.createdBy as unknown as { name?: string } | null)?.name ?? "—",
        createdAt: toDDMMYYYY(g.createdAt),
        status: g.status ?? "awaiting",
      })),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  async detail(id: string, auth: AuthPayload) {
    const grn = await this.findGrn(id);
    // Reuses the document guard rather than a second rule; also gives us the title.
    const doc = await documentsService.getOwnedOrAdmin(grn.documentId.toString(), auth);

    // `extracted.items` is the original 1:1 line-up the GRN's items were built from
    // (GRN capture never adds/removes rows, only edits description/quantity), so
    // position-matching is safe here.
    const extractedItems = (grn.extracted as { items?: Array<Record<string, unknown>> } | undefined)
      ?.items;

    return {
      id: grn._id.toString(),
      documentId: grn.documentId.toString(),
      title: doc.title,
      invoiceNo: grn.invoiceNo,
      invoiceDate: toDDMMYYYY(grn.invoiceDate),
      items: grn.items.map((item, i) => ({
        description: item.description,
        quantity: item.quantity,
        unit: unitOf(extractedItems?.[i]),
      })),
      status: grn.status ?? "awaiting",
      createdAt: toDDMMYYYY(grn.createdAt),
      decidedAt: grn.decidedAt ? toDDMMYYYY(grn.decidedAt) : undefined,
    };
  },

  /** Approve/reject, switchable in both directions — a mis-tap is undone by tapping the other. */
  async setStatus(id: string, status: GrnStatus, auth: AuthPayload) {
    const grn = await this.findGrn(id);
    await documentsService.getOwnedOrAdmin(grn.documentId.toString(), auth);

    grn.status = status;
    grn.decidedBy = new Types.ObjectId(auth.userId);
    grn.decidedAt = new Date();
    await grn.save();

    return { id: grn._id.toString(), status, decidedAt: grn.decidedAt };
  },

  /** Load only — authorization is the getOwnedOrAdmin call on the GRN's document. */
  async findGrn(id: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid GRN id");
    const grn = await Grn.findById(id);
    if (!grn) throw ApiError.notFound("GRN not found");
    return grn;
  },
};
