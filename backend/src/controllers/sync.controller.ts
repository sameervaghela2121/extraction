import type { Request, Response } from "express";
import { syncService } from "../services/sync.service";

export const syncController = {
  async flush(req: Request, res: Response) {
    res.json(await syncService.flush(req.body, req.auth!.userId));
  },
};
