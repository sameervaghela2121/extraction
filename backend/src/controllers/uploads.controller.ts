import type { Request, Response } from "express";
import { invoiceGeneratorClient, type UploadedFile } from "../services/invoiceGeneratorClient.service";
import { documentsService } from "../services/documents.service";
import { scanSessionService } from "../services/scanSession.service";
import { ApiError } from "../utils/ApiError";

function toUploadedFiles(files?: Express.Multer.File[]): UploadedFile[] {
  if (!files || files.length === 0) throw ApiError.badRequest("No files provided");
  return files.map((f) => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype }));
}

export const uploadsController = {
  async upload(req: Request, res: Response) {
    const files = toUploadedFiles(req.files as Express.Multer.File[] | undefined);
    const { jobId } = await invoiceGeneratorClient.extract(files);
    const docs = await documentsService.createFromExtraction(
      jobId,
      req.auth!.userId,
      "upload",
      files.length,
    );
    res.status(201).json({
      jobId,
      documents: docs.map((d) => ({ id: d._id.toString(), title: d.title, status: d.status })),
    });
  },

  async createScanSession(req: Request, res: Response) {
    const result = await scanSessionService.create(req.auth!);
    res.status(201).json(result);
  },

  async getScanSession(req: Request, res: Response) {
    const result = await scanSessionService.getState(req.params.token);
    res.json(result);
  },

  async addScanPage(req: Request, res: Response) {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw ApiError.badRequest("No page image provided");
    const result = await scanSessionService.addPage(req.params.token, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
    res.json(result);
  },

  async completeScanSession(req: Request, res: Response) {
    const result = await scanSessionService.complete(req.params.token);
    res.json(result);
  },

  async inboundEmailAddress(req: Request, res: Response) {
    // Single-tenant: derive a stable per-user inbox alias.
    const alias = req.auth!.userId.slice(-8);
    res.json({ address: `documents+${alias}@scan.docflow.app` });
  },
};
