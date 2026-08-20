import type { Request, Response } from "express";
import { rawMaterialsService } from "../services/rawMaterials.service";

export const rawMaterialsController = {
  async list(req: Request, res: Response) {
    res.json(await rawMaterialsService.list(req.query));
  },

  async get(req: Request, res: Response) {
    res.json(await rawMaterialsService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await rawMaterialsService.create(req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await rawMaterialsService.update(req.params.id, req.body));
  },

  async remove(req: Request, res: Response) {
    res.json(await rawMaterialsService.remove(req.params.id));
  },
};
