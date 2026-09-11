import type { Request, Response } from "express";
import { barcodeBatchesService } from "../services/barcodeBatches.service";

export const barcodeBatchesController = {
  async list(req: Request, res: Response) {
    res.json(await barcodeBatchesService.list(req.query));
  },

  async nextNumber(req: Request, res: Response) {
    const { prefix, date } = req.query as { prefix: string; date: string };
    res.json(await barcodeBatchesService.nextNumber(prefix, date));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await barcodeBatchesService.create(req.body, req.auth!));
  },

  async remove(req: Request, res: Response) {
    res.json(await barcodeBatchesService.remove(req.params.id));
  },
};
