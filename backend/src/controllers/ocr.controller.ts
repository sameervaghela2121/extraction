import type { Request, Response } from "express";
import { rollLabelAiService } from "../services/rollLabelAi.service";
import { ApiError } from "../utils/ApiError";

/**
 * Roll label reading, backed by the extraction service's Gemini route. The model is asked
 * for the fields directly, so nothing here has to work out which value sits under which
 * caption — which is what made the old OCR engines mis-read labels whose layout they had
 * never been fitted to.
 *
 * Deliberately one engine, no fallback. The engines disagreed on width: for a Schattdecor
 * label printing "1270/1250" the OCR path returned the paper width (1270) and this one the
 * print width (1250), which is what our own master data records. Falling back silently
 * would book the same roll at a different width depending on which engine happened to
 * answer — worse than a visible failure the operator can retry.
 */
async function readLabel(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest("Attach a photo of the label as `photo`");
  res.json(await rollLabelAiService.readRollLabel(req.file.buffer));
}

export const ocrController = {
  readRollLabel: readLabel,
};
