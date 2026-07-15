import { Types } from "mongoose";
import ExcelJS from "exceljs";
import { DocumentModel } from "../models/Document.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { FieldDefinition } from "../models/FieldDefinition.model";
import type { AuthPayload } from "../types/express";

export type ExportFormat = "csv" | "xlsx";

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

    const rows = docs.map((d) => {
      const inv = invoiceByFile.get(d.fileId.toString()) as unknown as Record<string, unknown> | undefined;
      const other = (inv?.other_fields as Record<string, unknown>) ?? {};
      const row: Record<string, unknown> = { Document: d.title, Status: d.status };
      for (const col of columns!) {
        row[col.label] = inv?.[col.key] ?? other[col.key] ?? "";
      }
      return row;
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `invoices-${stamp}.${input.format}`;
    const headers = ["Document", "Status", ...columns.map((c) => c.label)];

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
