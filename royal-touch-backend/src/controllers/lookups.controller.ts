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

  async createClient(req: Request, res: Response) {
    const { created, client } = await lookupsService.findOrCreateClient(req.body.name);

    // 201 only when a row was actually written; 200 says "this already existed, here it is".
    // The client is returned either way so the operator can carry on issuing the roll — the
    // message tells them why no new entry appeared, rather than leaving them to wonder.
    res.status(created ? 201 : 200).json({
      alreadyExists: !created,
      message: created
        ? "Client added"
        : `"${client.name}" already exists and has been selected`,
      client,
    });
  },

  async suppliers(req: Request, res: Response) {
    const { search } = req.query as LookupQuery;
    res.json({ items: await lookupsService.suppliers(search) });
  },
};
