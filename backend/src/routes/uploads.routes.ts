import { Router } from "express";
import { uploadsController } from "../controllers/uploads.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadMemory } from "../middleware/upload.middleware";

const router = Router();

router.use(requireAuth);

// File upload channel (also used by the mobile camera-capture flow, tagged via req.body.source)
router.post("/documents/upload", uploadMemory.array("files", 20), asyncHandler(uploadsController.upload));

// Email-in channel
router.get("/inbound-email-address", asyncHandler(uploadsController.inboundEmailAddress));

export default router;
