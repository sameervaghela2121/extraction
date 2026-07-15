import type { Request, Response } from "express";
import { fieldDefinitionsService } from "../services/fieldDefinitions.service";

export const fieldDefinitionsController = {
  async list(_req: Request, res: Response) {
    res.json(await fieldDefinitionsService.list());
  },

  async toggle(req: Request, res: Response) {
    res.json(await fieldDefinitionsService.toggle(req.params.fieldKey, Boolean(req.body.enabled)));
  },

  async addCustom(req: Request, res: Response) {
    res.status(201).json(await fieldDefinitionsService.addCustom(req.body));
  },

  async reorder(req: Request, res: Response) {
    res.json(await fieldDefinitionsService.reorder(req.body.keys));
  },

  async remove(req: Request, res: Response) {
    res.json(await fieldDefinitionsService.remove(req.params.fieldKey));
  },
};
