import type { Request, Response } from "express";
import { lookupsService } from "../services/lookups.service";

type LookupQuery = { search?: string; supplierId?: string };

export const lookupsController = {
  async locations(req: Request, res: Response) {
    const { search } = req.query as LookupQuery;
    res.json({ items: await lookupsService.locations(search) });
  },

  async batches(req: Request, res: Response) {
    const { supplierId, search } = req.query as LookupQuery;
    res.json({ items: await lookupsService.batches(supplierId, search) });
  },

  async clients(req: Request, res: Response) {
    const { search } = req.query as LookupQuery;
    res.json({ items: await lookupsService.clients(search) });
  },

  async suppliers(req: Request, res: Response) {
    const { search } = req.query as LookupQuery;
    res.json({ items: await lookupsService.suppliers(search) });
  },
};
