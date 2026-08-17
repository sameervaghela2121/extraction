import type { Request, Response } from "express";
import { materialsService } from "../services/materials.service";

export const materialsController = {
  async list(req: Request, res: Response) {
    const { search, page, limit } = req.query as unknown as {
      search?: string;
      page: number;
      limit: number;
    };
    res.json(await materialsService.list(search, page, limit));
  },

  async detail(req: Request, res: Response) {
    res.json(await materialsService.detail(req.params.materialId));
  },
};
