import type { Request, Response } from "express";
import { mediaService } from "../services/media.service";

export const appController = {
  async apkDownloadUrl(_req: Request, res: Response) {
    res.json({ url: await mediaService.signedApkDownloadUrl() });
  },
};
