import type { Request, Response } from "express";
import { stockService } from "../services/stock.service";

export const stockController = {
  async recordMovement(req: Request, res: Response) {
    res.status(201).json(await stockService.recordMovement(req.body, req.auth!.userId));
  },

  async listMovements(req: Request, res: Response) {
    res.json(await stockService.listMovements(req.query));
  },

  async summary(req: Request, res: Response) {
    res.json(await stockService.summary(req.query.material_id as string | undefined));
  },
};
