import type { Request, Response } from "express";
import { syncLogsService } from "../services/syncLogs.service";

export const syncLogsController = {
  async list(req: Request, res: Response) {
    res.json(await syncLogsService.list(req.query));
  },

  async get(req: Request, res: Response) {
    res.json(await syncLogsService.get(req.params.id));
  },
};
