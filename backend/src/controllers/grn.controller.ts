import type { Request, Response } from "express";
import { grnService } from "../services/grn.service";

export const grnController = {
  async draft(req: Request, res: Response) {
    const { documentIds } = req.query as { documentIds: string };
    const ids = documentIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    res.json(await grnService.draft(ids, req.auth!));
  },

  async save(req: Request, res: Response) {
    res.status(201).json(await grnService.save(req.body, req.auth!));
  },
};
