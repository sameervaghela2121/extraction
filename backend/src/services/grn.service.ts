import { Types } from "mongoose";
import { Grn, type IGrnItem } from "../models/Grn.model";
import { SharedFile } from "../models/SharedFiles.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { documentsService } from "./documents.service";
import { ApiError } from "../utils/ApiError";
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
              invoiceDate: existing?.invoiceDate ?? invoice.invoice_date ?? "",
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
      invoiceDate: grn!.invoiceDate,
      items: grn!.items,
      saved: true,
    };
  },
};
