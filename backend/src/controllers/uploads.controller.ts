import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { invoiceGeneratorClient, type StorageFileRef, type UploadedFile } from "../services/invoiceGeneratorClient.service";
import { documentsService } from "../services/documents.service";
import { fieldDefinitionsService } from "../services/fieldDefinitions.service";
import { presignUploads, getObjectSize } from "../services/gcsUpload.service";
import { imagesToPdf } from "../utils/imagesToPdf";
import { ApiError } from "../utils/ApiError";
import { SharedFile } from "../models/SharedFiles.model";
import { PendingUpload } from "../models/PendingUpload.model";
import type { DocumentPurpose, DocumentSource } from "../models/Document.model";
import type { presignSchema, confirmUploadSchema } from "../validators/uploads.validators";
import type { z } from "zod";

function toUploadedFiles(files?: Express.Multer.File[]): UploadedFile[] {
  if (!files || files.length === 0) throw ApiError.badRequest("No files provided");
  return files.map((f) => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype }));
}

function parseSource(value: unknown): DocumentSource {
  return value === "scan" ? "scan" : "upload";
}

function parsePurpose(value: unknown): DocumentPurpose {
  return value === "grn" ? "grn" : "invoice";
}

export const uploadsController = {
  async upload(req: Request, res: Response) {
    const body = req.body as { source?: unknown; purpose?: unknown } | undefined;
    const source = parseSource(body?.source);
    const purpose = parsePurpose(body?.purpose);
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
    const docs = await documentsService.createFromExtraction(
      jobId,
      req.auth!.userId,
      source,
      files.length,
      purpose,
    );
    res.status(201).json({
      jobId,
      documents: docs.map((d) => ({ id: d._id.toString(), title: d.title, status: d.status })),
    });
  },

  /** Step 1 of the direct-to-GCS flow: mint one signed PUT URL per file the browser is about
   *  to upload. No bytes touch this server — the browser PUTs straight to GCS next. We also
   *  record exactly which objects this jobId covers, scoped to this user — confirm() below
   *  trusts only this record, never a client-supplied objectPath (a client could otherwise
   *  point confirm() at any object in the shared bucket, including another user's upload). */
  async presign(req: Request, res: Response) {
    const body = req.body as z.infer<typeof presignSchema>;
    const jobId = randomUUID();
    const uploads = await presignUploads(jobId, body.files);
    await PendingUpload.create({
      jobId,
      userId: req.auth!.userId,
      files: uploads.map((u) => ({
        idx: u.idx,
        filename: u.filename,
        mimetype: u.mimetype,
        objectPath: u.objectPath,
      })),
    });
    res.status(200).json({ jobId, uploads });
  },

  /** Step 2: the browser has finished PUTting every file to GCS and tells us so here. We
   *  register the Files docs ourselves (the extraction service used to do this at multipart-
   *  receive time; now it only ever sees a GCS path, never raw bytes), then hand the job to
   *  the extraction service to download, preprocess, and run Gemini on. Which objects this
   *  covers comes entirely from the PendingUpload record presign() made for this user — never
   *  from anything the client sends here. */
  async confirm(req: Request, res: Response) {
    const body = req.body as z.infer<typeof confirmUploadSchema>;
    const { jobId, purpose, source } = body;

    const pending = await PendingUpload.findOne({ jobId, userId: req.auth!.userId });
    if (!pending) {
      throw ApiError.badRequest("Unknown or expired upload session");
    }
    const files = pending.files.slice().sort((a, b) => a.idx - b.idx);

    const sizes = await Promise.all(files.map((f) => getObjectSize(f.objectPath)));
    const missing = files.filter((_, i) => sizes[i] == null).map((f) => f.filename);
    if (missing.length > 0) {
      throw ApiError.badRequest(`Upload not found in storage: ${missing.join(", ")}`);
    }

    const now = new Date();
    const isScan = source === "scan";

    // Camera-captured pages are pages of one document — one Files record (and later, one
    // portal Document) for the whole batch, same grouping the legacy flow's server-side
    // imagesToPdf() merge produced. Picked files (source=upload) stay independent. The
    // extraction service does the actual page-merging now (it's the one holding the bytes);
    // this doc is just a placeholder it fills in once that merge + analysis finishes.
    const scanTitle = `Scan · ${now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
    const fileDocs = isScan
      ? [
          {
            job_id: jobId,
            filename: scanTitle,
            mime: "application/pdf",
            size: 0,
            path: `gcs://${files[0].objectPath}`,
            idx: 1,
            status: "processing" as const,
            invoice_count: 0,
            renamed: false,
            title: scanTitle,
            created_at: now,
          },
        ]
      : files.map((f, i) => ({
          job_id: jobId,
          filename: f.filename,
          mime: f.mimetype,
          size: sizes[i]!,
          path: `gcs://${f.objectPath}`,
          idx: i + 1,
          status: "processing" as const,
          invoice_count: 0,
          renamed: false,
          title: f.filename,
          created_at: now,
        }));
    const inserted = await SharedFile.insertMany(fileDocs);
    // One-shot: this session's objects are now owned by real Files docs, so the record that
    // let confirm() see them can't be replayed against a second confirm() call.
    await PendingUpload.deleteOne({ _id: pending._id });

    // For a scan batch every raw photo still needs to reach the extraction service (it has
    // to download and merge all of them) even though they collapse into that single Mongo
    // doc above — so every ref shares that doc's _id, and idx orders the pages for merging.
    const storageRefs: StorageFileRef[] = isScan
      ? files.map((f, i) => ({
          _id: inserted[0]._id.toString(),
          idx: i + 1,
          filename: scanTitle,
          mime: f.mimetype,
          path: `gcs://${f.objectPath}`,
        }))
      : inserted.map((doc, i) => ({
          _id: doc._id.toString(),
          idx: fileDocs[i].idx,
          filename: fileDocs[i].filename,
          mime: fileDocs[i].mime,
          path: fileDocs[i].path,
        }));

    const customFields = await fieldDefinitionsService.listEnabledCustomForPrompt();
    await invoiceGeneratorClient.analyzeFromStorage(jobId, storageRefs, source, customFields);

    const docs = await documentsService.createFromExtraction(
      jobId,
      req.auth!.userId,
      source,
      isScan ? 1 : files.length,
      purpose,
    );
    res.status(201).json({
      jobId,
      documents: docs.map((d) => ({ id: d._id.toString(), title: d.title, status: d.status })),
    });
  },
};
