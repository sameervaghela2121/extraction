import { Router } from "express";
import { grnController } from "../controllers/grn.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { saveGrnSchema, draftQuerySchema } from "../validators/grn.validators";

const router = Router();

// No admin gate — receiving staff are the intended users.
router.use(requireAuth);

router.get("/draft", validate({ query: draftQuerySchema }), asyncHandler(grnController.draft));
router.post("/", validate({ body: saveGrnSchema }), asyncHandler(grnController.save));

export default router;
