import type { Request, Response } from "express";
import { ocrService } from "../services/ocr.service";
import { ApiError } from "../utils/ApiError";

export const ocrController = {
  async readRollLabel(req: Request, res: Response) {
    if (!req.file) throw ApiError.badRequest("Attach a photo of the label as `photo`");
    res.json(await ocrService.readRollLabel(req.file.buffer));
  },
};
