import { Router } from "express";
import { exportController } from "../controllers/export.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { generateExportSchema } from "../validators/export.validators";

const router = Router();

router.use(requireAuth);

router.get("/preview-count", asyncHandler(exportController.previewCount));
router.post("/", validate({ body: generateExportSchema }), asyncHandler(exportController.generate));
router.get("/history", asyncHandler(exportController.history));
router.get("/:id/download", asyncHandler(exportController.download));

export default router;
