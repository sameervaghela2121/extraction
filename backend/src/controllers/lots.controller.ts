import type { Request, Response } from "express";
import { lotsService } from "../services/lots.service";

export const lotsController = {
  async list(req: Request, res: Response) {
    res.json(await lotsService.list(req.query));
  },

  async get(req: Request, res: Response) {
    res.json(await lotsService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await lotsService.create(req.body, req.auth!.userId));
  },
};
