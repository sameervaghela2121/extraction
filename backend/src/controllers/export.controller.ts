import type { Request, Response } from "express";
import { exportService } from "../services/export.service";

export const exportController = {
  async previewCount(req: Request, res: Response) {
    const { status, dateFrom, dateTo } = req.query as Record<string, string>;
    const count = await exportService.previewCount(req.auth!, { status, dateFrom, dateTo });
    res.json({ count });
  },

  async generate(req: Request, res: Response) {
    const { buffer, filename, contentType } = await exportService.generate(req.auth!, req.body);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  },
};
