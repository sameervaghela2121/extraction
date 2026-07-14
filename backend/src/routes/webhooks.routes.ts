import { Router } from "express";
import { webhooksController } from "../controllers/webhooks.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { uploadMemory } from "../middleware/upload.middleware";

const router = Router();

// Public (no JWT) — must be secured with the email provider's signature verification in production.
router.post("/inbound-email", uploadMemory.array("files", 20), asyncHandler(webhooksController.inboundEmail));

export default router;
