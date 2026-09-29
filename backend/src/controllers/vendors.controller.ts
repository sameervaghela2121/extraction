import type { Request, Response } from "express";
import { vendorsService } from "../services/vendors.service";

export const vendorsController = {
  async list(req: Request, res: Response) {
    res.json(await vendorsService.list(req.query));
  },

  async search(req: Request, res: Response) {
    res.json(await vendorsService.search(req.body));
  },

  async searchPapers(req: Request, res: Response) {
    res.json(await vendorsService.searchPapers(req.body));
  },

  async get(req: Request, res: Response) {
    res.json(await vendorsService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await vendorsService.create(req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await vendorsService.update(req.params.id, req.body));
  },

  async remove(req: Request, res: Response) {
    res.json(await vendorsService.remove(req.params.id));
  },
};
