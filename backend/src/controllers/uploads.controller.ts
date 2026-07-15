import type { Request, Response } from "express";
import { invoiceGeneratorClient, type UploadedFile } from "../services/invoiceGeneratorClient.service";
import { documentsService } from "../services/documents.service";
import { fieldDefinitionsService } from "../services/fieldDefinitions.service";
import { imagesToPdf } from "../utils/imagesToPdf";
import { ApiError } from "../utils/ApiError";
import type { DocumentSource } from "../models/Document.model";

function toUploadedFiles(files?: Express.Multer.File[]): UploadedFile[] {
  if (!files || files.length === 0) throw ApiError.badRequest("No files provided");
  return files.map((f) => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype }));
}

function parseSource(value: unknown): DocumentSource {
  return value === "scan" ? "scan" : "upload";
}

export const uploadsController = {
  async upload(req: Request, res: Response) {
    const source = parseSource((req.body as { source?: unknown } | undefined)?.source);
    const rawFiles = toUploadedFiles(req.files as Express.Multer.File[] | undefined);

    // Camera-captured pages are pages of one document — merge them into a single
    // multi-page PDF so the extraction service treats them as one invoice, the same
    // way it already treats any multi-page PDF upload. Picked files (source=upload)
    // stay independent, since those are typically separate invoices.
    const files: UploadedFile[] =
      source === "scan"
        ? [
            {
              buffer: await imagesToPdf(rawFiles.map((f) => f.buffer)),
              originalname: `scan-${Date.now()}.pdf`,
              mimetype: "application/pdf",
            },
          ]
        : rawFiles;

    const customFields = await fieldDefinitionsService.listEnabledCustomForPrompt();
    const { jobId } = await invoiceGeneratorClient.extract(files, customFields);
    const docs = await documentsService.createFromExtraction(jobId, req.auth!.userId, source, files.length);
    res.status(201).json({
      jobId,
      documents: docs.map((d) => ({ id: d._id.toString(), title: d.title, status: d.status })),
    });
  },
};
