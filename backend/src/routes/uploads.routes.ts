import { Router } from "express";
import { uploadsController } from "../controllers/uploads.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { uploadMemory } from "../middleware/upload.middleware";
import { presignSchema, confirmUploadSchema } from "../validators/uploads.validators";

const router = Router();

router.use(requireAuth);

// Legacy upload channel — bytes are relayed through this server to the extraction service.
// Kept until the direct-to-GCS flow below is verified in production, then removed.
router.post("/documents/upload", uploadMemory.array("files", 20), asyncHandler(uploadsController.upload));

// Direct-to-GCS upload: the browser PUTs bytes straight to storage using the signed URL(s)
// this mints, then confirms once every PUT has succeeded.
router.post(
  "/documents/upload/presign",
  validate({ body: presignSchema }),
  asyncHandler(uploadsController.presign),
);
router.post(
  "/documents/upload/confirm",
  validate({ body: confirmUploadSchema }),
  asyncHandler(uploadsController.confirm),
);

export default router;
