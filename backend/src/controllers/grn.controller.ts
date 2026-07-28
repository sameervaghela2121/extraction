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

  async list(req: Request, res: Response) {
    const { page, pageSize, search } = req.query as unknown as {
      page?: number;
      pageSize?: number;
      search?: string;
    };
    res.json(await grnService.list(req.auth!, { page, pageSize, search }));
  },

  async detail(req: Request, res: Response) {
    res.json(await grnService.detail(req.params.id, req.auth!));
  },

  async setStatus(req: Request, res: Response) {
    res.json(await grnService.setStatus(req.params.id, req.body.status, req.auth!));
  },

  async updateQuantities(req: Request, res: Response) {
    res.json(await grnService.updateQuantities(req.params.id, req.body.quantities, req.auth!));
  },
};
