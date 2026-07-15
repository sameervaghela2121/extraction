import { Types } from "mongoose";
import ExcelJS from "exceljs";
import { DocumentModel } from "../models/Document.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { FieldDefinition } from "../models/FieldDefinition.model";
import type { AuthPayload } from "../types/express";

export type ExportFormat = "csv" | "xlsx";

/** Line items are `Schema.Types.Mixed` — different PDFs can extract different item
 * shapes, so there's no fixed key set to assume. `Item ` + humanized key keeps this
 * distinct from any invoice-level column that happens to share a name (e.g. "amount"). */
function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ExportFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildDocumentFilter(auth: AuthPayload, filters: ExportFilters): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (auth.role !== "admin") filter.ownerId = new Types.ObjectId(auth.userId);
  if (filters.status && filters.status !== "all") filter.status = filters.status;
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, Date> = {};
    if (filters.dateFrom) range.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) range.$lte = new Date(filters.dateTo);
    filter.uploadedAt = range;
  }
  return filter;
}

export const exportService = {
  async previewCount(auth: AuthPayload, filters: ExportFilters): Promise<number> {
    return DocumentModel.countDocuments(buildDocumentFilter(auth, filters));
  },

  /** Builds the export in memory and hands back the raw file — nothing is written to disk
   * or persisted as "history", so there's nothing to go stale or 404 later. */
  async generate(
    auth: AuthPayload,
    input: {
      format: ExportFormat;
      columns?: Array<{ key: string; label: string }>;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const filter = buildDocumentFilter(auth, input);
    const docs = await DocumentModel.find(filter).sort({ uploadedAt: -1 }).lean();
    const fileIds = docs.map((d) => d.fileId);
    const invoices = await SharedInvoice.find({ file_id: { $in: fileIds } }).lean();
    const invoiceByFile = new Map<string, ISharedInvoice>();
    for (const inv of invoices) {
      const key = inv.file_id?.toString();
      if (key && !invoiceByFile.has(key)) invoiceByFile.set(key, inv as ISharedInvoice);
    }

    // Columns: use provided selection, else all enabled field definitions.
    let columns = input.columns;
    if (!columns || columns.length === 0) {
      const defs = await FieldDefinition.find({ enabled: true }).sort({ order: 1 }).lean();
      columns = defs.map((d) => ({ key: d.key, label: d.label }));
    }

    // Line items per doc, plus the union of every key seen across all of them (in first-seen
    // order) — that union becomes the item columns, so no PDF's fields get silently dropped
    // just because another PDF's items happened to use different keys.
    const itemsByDoc = new Map<string, Array<Record<string, unknown>>>();
    const itemKeys: string[] = [];
    const seenItemKeys = new Set<string>();
    for (const d of docs) {
      const inv = invoiceByFile.get(d.fileId.toString()) as unknown as Record<string, unknown> | undefined;
      const items = (inv?.items as Array<Record<string, unknown>> | undefined) ?? [];
      itemsByDoc.set(d.fileId.toString(), items);
      for (const item of items) {
        for (const key of Object.keys(item)) {
          if (!seenItemKeys.has(key)) {
            seenItemKeys.add(key);
            itemKeys.push(key);
          }
        }
      }
    }
    const itemColumns = itemKeys.map((key) => ({ key, label: `Item ${humanizeKey(key)}` }));

    const rows: Record<string, unknown>[] = [];
    for (const d of docs) {
      const inv = invoiceByFile.get(d.fileId.toString()) as unknown as Record<string, unknown> | undefined;
      const other = (inv?.other_fields as Record<string, unknown>) ?? {};
      const invoiceCells: Record<string, unknown> = { Document: d.title, Status: d.status };
      for (const col of columns!) {
        invoiceCells[col.label] = inv?.[col.key] ?? other[col.key] ?? "";
      }

      const items = itemsByDoc.get(d.fileId.toString()) ?? [];
      const itemRows = items.length === 0 ? [{}] : items;
      for (const item of itemRows) {
        const row: Record<string, unknown> = { ...invoiceCells };
        for (const col of itemColumns) row[col.label] = item[col.key] ?? "";
        rows.push(row);
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `invoices-${stamp}.${input.format}`;
    const headers = ["Document", "Status", ...columns.map((c) => c.label), ...itemColumns.map((c) => c.label)];

    const buffer =
      input.format === "csv" ? buildCsv(headers, rows) : await buildXlsx(headers, rows);
    const contentType =
      input.format === "csv"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return { buffer, filename, contentType, rowCount: rows.length };
  },
};

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(headers: string[], rows: Record<string, unknown>[]): Buffer {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

async function buildXlsx(headers: string[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Invoices");
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h] ?? ""));
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
