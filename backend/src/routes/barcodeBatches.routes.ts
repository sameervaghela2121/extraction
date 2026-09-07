import { Router } from "express";
import { barcodeBatchesController } from "../controllers/barcodeBatches.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createBarcodeBatchSchema,
  listBarcodeBatchesQuerySchema,
} from "../validators/barcodeBatches.validators";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  validate({ query: listBarcodeBatchesQuerySchema }),
  asyncHandler(barcodeBatchesController.list),
);
router.post(
  "/",
  requireGodownWrite,
  validate({ body: createBarcodeBatchSchema }),
  asyncHandler(barcodeBatchesController.create),
);
router.delete("/:id", requireGodownWrite, asyncHandler(barcodeBatchesController.remove));

export default router;
