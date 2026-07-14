import { Router } from "express";
import { uploadsController } from "../controllers/uploads.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadMemory } from "../middleware/upload.middleware";

const router = Router();

router.use(requireAuth);

// File upload channel
router.post("/documents/upload", uploadMemory.array("files", 20), asyncHandler(uploadsController.upload));

// Mobile scan-session channel
router.post("/scan-sessions", asyncHandler(uploadsController.createScanSession));
router.get("/scan-sessions/:token", asyncHandler(uploadsController.getScanSession));
router.post(
  "/scan-sessions/:token/pages",
  uploadMemory.single("page"),
  asyncHandler(uploadsController.addScanPage),
);
router.post("/scan-sessions/:token/complete", asyncHandler(uploadsController.completeScanSession));

// Email-in channel
router.get("/inbound-email-address", asyncHandler(uploadsController.inboundEmailAddress));

export default router;
