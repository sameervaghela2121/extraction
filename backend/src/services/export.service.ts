import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import ExcelJS from "exceljs";
import { DocumentModel } from "../models/Document.model";
import { SharedInvoice, type ISharedInvoice } from "../models/SharedInvoice.model";
import { ExportJob, type ExportFormat } from "../models/ExportJob.model";
import { FieldDefinition } from "../models/FieldDefinition.model";
import { ApiError } from "../utils/ApiError";
import type { AuthPayload } from "../types/express";

const EXPORT_DIR = path.resolve(process.cwd(), "storage", "exports");

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

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `invoices-${stamp}.${input.format}`;
    const filePath = path.join(EXPORT_DIR, filename);
    const headers = ["Document", "Status", ...columns.map((c) => c.label)];

    if (input.format === "csv") {
      await writeCsv(filePath, headers, rows);
    } else {
      await writeXlsx(filePath, headers, rows);
    }

    const job = await ExportJob.create({
      filename,
      format: input.format,
      filters: {
        status: input.status,
        dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
        dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
      },
      columns,
      rowCount: rows.length,
      generatedBy: new Types.ObjectId(auth.userId),
      filePath,
    });

    return {
      id: job._id.toString(),
      filename,
      format: input.format,
      rowCount: rows.length,
      generatedAt: job.generatedAt,
    };
  },

  async history(auth: AuthPayload) {
    const filter = auth.role === "admin" ? {} : { generatedBy: new Types.ObjectId(auth.userId) };
    const jobs = await ExportJob.find(filter).sort({ generatedAt: -1 }).limit(50).lean();
    return jobs.map((j) => ({
      id: j._id.toString(),
      filename: j.filename,
      format: j.format,
      rowCount: j.rowCount,
      generatedAt: j.generatedAt,
    }));
  },

  async getDownload(auth: AuthPayload, id: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid export id");
    const job = await ExportJob.findById(id);
    if (!job) throw ApiError.notFound("Export not found");
    if (auth.role !== "admin" && job.generatedBy.toString() !== auth.userId) {
      throw ApiError.forbidden("You do not have access to this export");
    }
    if (!fs.existsSync(job.filePath)) throw ApiError.notFound("Export file is no longer available");
    return { filePath: job.filePath, filename: job.filename, format: job.format };
  },
};

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeCsv(filePath: string, headers: string[], rows: Record<string, unknown>[]) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  await fs.promises.writeFile(filePath, lines.join("\n"), "utf8");
}

async function writeXlsx(filePath: string, headers: string[], rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Invoices");
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h] ?? ""));
  }
  await wb.xlsx.writeFile(filePath);
}
