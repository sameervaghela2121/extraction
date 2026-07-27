import { Router } from "express";
import { grnController } from "../controllers/grn.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  saveGrnSchema,
  draftQuerySchema,
  listQuerySchema,
  statusSchema,
} from "../validators/grn.validators";

const router = Router();

// No admin gate — receiving staff are the intended users.
router.use(requireAuth);

// "/draft" must stay above "/:id" or the literal path is swallowed by the param route.
router.get("/draft", validate({ query: draftQuerySchema }), asyncHandler(grnController.draft));
router.get("/", validate({ query: listQuerySchema }), asyncHandler(grnController.list));
router.post("/", validate({ body: saveGrnSchema }), asyncHandler(grnController.save));
router.get("/:id", asyncHandler(grnController.detail));
router.patch("/:id/status", validate({ body: statusSchema }), asyncHandler(grnController.setStatus));

export default router;
