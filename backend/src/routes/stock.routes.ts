import { Router } from "express";
import { stockController } from "../controllers/stock.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  recordMovementSchema,
  listMovementsQuerySchema,
  summaryQuerySchema,
} from "../validators/stock.validators";

const router = Router();

const canWrite = requireGodownWrite;

router.use(requireAuth);

router.post(
  "/movements",
  canWrite,
  validate({ body: recordMovementSchema }),
  asyncHandler(stockController.recordMovement),
);
router.get(
  "/movements",
  validate({ query: listMovementsQuerySchema }),
  asyncHandler(stockController.listMovements),
);
router.get("/summary", validate({ query: summaryQuerySchema }), asyncHandler(stockController.summary));

export default router;
