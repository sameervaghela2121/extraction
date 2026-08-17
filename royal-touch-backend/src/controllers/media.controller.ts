import type { Request, Response } from "express";
import { mediaService } from "../services/media.service";
import { ApiError } from "../utils/ApiError";

export const mediaController = {
  async upload(req: Request, res: Response) {
    if (!req.file) throw ApiError.badRequest("No file uploaded — expected a 'file' field");

    const objectPath = await mediaService.upload(req.file);

    // Both are returned: the path is what the roll registration submits back and what the
    // database stores; the URL is for showing the operator what they just captured.
    res.status(201).json({
      objectPath,
      mediaUrl: await mediaService.signedReadUrl(objectPath),
    });
  },
};
