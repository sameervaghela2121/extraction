import type { Request, Response } from "express";
import { MEDIA_FOLDERS, mediaService, type MediaFolder } from "../services/media.service";
import { ApiError } from "../utils/ApiError";

export const mediaController = {
  async upload(req: Request, res: Response) {
    if (!req.file) throw ApiError.badRequest("No file uploaded — expected a 'file' field");

    // Optional "folder" form field: "lots" for a challan photo, otherwise a roll photo. An
    // allow-list, so a client cannot write anywhere else in the bucket.
    const requested = typeof req.body?.folder === "string" ? req.body.folder : "rolls";
    if (!MEDIA_FOLDERS.includes(requested as MediaFolder)) {
      throw ApiError.badRequest(`folder must be one of: ${MEDIA_FOLDERS.join(", ")}`);
    }
    const objectPath = await mediaService.upload(req.file, requested as MediaFolder);

    // Both are returned: the path is what the roll registration submits back and what the
    // database stores; the URL is for showing the operator what they just captured.
    res.status(201).json({
      objectPath,
      mediaUrl: await mediaService.signedReadUrl(objectPath),
    });
  },
};
