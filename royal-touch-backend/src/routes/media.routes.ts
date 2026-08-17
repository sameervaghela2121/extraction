import { Router } from "express";
import { mediaController } from "../controllers/media.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadImage } from "../middleware/upload.middleware";

const router = Router();

router.use(requireAuth);

// One file per request, field name "file". The registration flow captures four photos and
// uploads them one at a time, so a failed shot is retried alone rather than the whole set.
router.post("/upload", uploadImage.single("file"), asyncHandler(mediaController.upload));

export default router;
