import type { Request, Response } from "express";
import { materialRollsService } from "../services/materialRolls.service";

export const materialRollsController = {
  async list(req: Request, res: Response) {
    res.json(await materialRollsService.list(req.query));
  },

  async get(req: Request, res: Response) {
    res.json(await materialRollsService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await materialRollsService.create(req.body, req.auth!.userId));
  },

  async update(req: Request, res: Response) {
    res.json(await materialRollsService.update(req.params.id, req.body));
  },

  async remove(req: Request, res: Response) {
    res.json(await materialRollsService.remove(req.params.id));
  },
};
