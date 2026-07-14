import type { Request, Response } from "express";
import { exportService } from "../services/export.service";

export const exportController = {
  async previewCount(req: Request, res: Response) {
    const { status, dateFrom, dateTo } = req.query as Record<string, string>;
    const count = await exportService.previewCount(req.auth!, { status, dateFrom, dateTo });
    res.json({ count });
  },

  async generate(req: Request, res: Response) {
    const result = await exportService.generate(req.auth!, req.body);
    res.status(201).json(result);
  },

  async history(req: Request, res: Response) {
    res.json(await exportService.history(req.auth!));
  },

  async download(req: Request, res: Response) {
    const { filePath, filename } = await exportService.getDownload(req.auth!, req.params.id);
    res.download(filePath, filename);
  },
};
