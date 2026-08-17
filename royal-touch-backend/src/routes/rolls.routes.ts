import { Router } from "express";
import { rollsController } from "../controllers/rolls.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  searchQuerySchema,
  barcodeParamsSchema,
  createRollSchema,
  updateStatusSchema,
  adjustWeightSchema,
} from "../validators/rolls.validators";

const router = Router();

router.use(requireAuth);

// The two literal paths must stay above "/:barcodeId" or the param route swallows them.
router.get("/search", validate({ query: searchQuerySchema }), asyncHandler(rollsController.search));
router.post("/barcode/generate", asyncHandler(rollsController.generateBarcode));

router.post("/", validate({ body: createRollSchema }), asyncHandler(rollsController.create));
router.get(
  "/:barcodeId",
  validate({ params: barcodeParamsSchema }),
  asyncHandler(rollsController.detail),
);
router.patch(
  "/:barcodeId/status",
  validate({ params: barcodeParamsSchema, body: updateStatusSchema }),
  asyncHandler(rollsController.updateStatus),
);
router.patch(
  "/:barcodeId/weight",
  validate({ params: barcodeParamsSchema, body: adjustWeightSchema }),
  asyncHandler(rollsController.adjustWeight),
);
router.get(
  "/:barcodeId/history",
  validate({ params: barcodeParamsSchema }),
  asyncHandler(rollsController.history),
);
router.get(
  "/:barcodeId/barcode/print",
  validate({ params: barcodeParamsSchema }),
  asyncHandler(rollsController.print),
);

export default router;
