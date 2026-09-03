import type { Request, Response } from "express";
import { remarksService } from "../services/remarks.service";

export const remarksController = {
  async list(req: Request, res: Response) {
    res.json(await remarksService.list(req.query));
  },

  async get(req: Request, res: Response) {
    res.json(await remarksService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await remarksService.create(req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await remarksService.update(req.params.id, req.body));
  },

  async remove(req: Request, res: Response) {
    res.json(await remarksService.remove(req.params.id));
  },
};
