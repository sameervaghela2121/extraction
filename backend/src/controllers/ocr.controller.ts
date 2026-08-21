import type { Request, Response } from "express";
import { ocrService } from "../services/ocr.service";
import { rollLabelAiService } from "../services/rollLabelAi.service";
import { ApiError } from "../utils/ApiError";

export const ocrController = {
  async readRollLabel(req: Request, res: Response) {
    if (!req.file) throw ApiError.badRequest("Attach a photo of the label as `photo`");
    res.json(await ocrService.readRollLabel(req.file.buffer));
  },

  /** Gemini reads the fields directly — no OCR text, no geometry parsing on this side. */
  async readRollLabelAi(req: Request, res: Response) {
    if (!req.file) throw ApiError.badRequest("Attach a photo of the label as `photo`");
    res.json(await rollLabelAiService.readRollLabel(req.file.buffer));
  },
};
