import { Router } from "express";
import { barcodeBatchesController } from "../controllers/barcodeBatches.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createBarcodeBatchSchema,
  listBarcodeBatchesQuerySchema,
  nextNumberQuerySchema,
} from "../validators/barcodeBatches.validators";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  validate({ query: listBarcodeBatchesQuerySchema }),
  asyncHandler(barcodeBatchesController.list),
);
// Before "/:id" would ever match it, and read-only, so it needs no write role.
router.get(
  "/next-number",
  validate({ query: nextNumberQuerySchema }),
  asyncHandler(barcodeBatchesController.nextNumber),
);
router.post(
  "/",
  requireGodownWrite,
  validate({ body: createBarcodeBatchSchema }),
  asyncHandler(barcodeBatchesController.create),
);
router.delete("/:id", requireGodownWrite, asyncHandler(barcodeBatchesController.remove));

export default router;
