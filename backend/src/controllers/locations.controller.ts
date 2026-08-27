import type { Request, Response } from "express";
import { locationsService } from "../services/locations.service";

export const locationsController = {
  async list(req: Request, res: Response) {
    res.json(await locationsService.list(req.query));
  },

  async get(req: Request, res: Response) {
    res.json(await locationsService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await locationsService.create(req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await locationsService.update(req.params.id, req.body));
  },

  async remove(req: Request, res: Response) {
    res.json(await locationsService.remove(req.params.id));
  },
};
