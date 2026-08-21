import { Router } from "express";
import { ocrController } from "../controllers/ocr.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadMemory } from "../middleware/upload.middleware";

const router = Router();

router.use(requireAuth);

// Read-only: this only reads a photo and hands the values back for the client to confirm
// before it posts them anywhere. Nothing is stored, so no write role is needed.
router.post(
  "/roll-label",
  uploadMemory.single("photo"),
  asyncHandler(ocrController.readRollLabel),
);

// Gemini instead of OCR: the model is asked for the fields directly, so nothing on this
// side has to work out which value sits under which caption. Same response shape as
// /roll-label, with engine "gemini".
router.post(
  "/roll-label-ai",
  uploadMemory.single("photo"),
  asyncHandler(ocrController.readRollLabelAi),
);

export default router;
