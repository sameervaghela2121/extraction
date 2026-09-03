import { Router } from "express";
import { materialRollsController } from "../controllers/materialRolls.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createRollSchema,
  updateRollSchema,
  listRollsQuerySchema,
} from "../validators/materialRolls.validators";

const router = Router();

const canWrite = requireGodownWrite;

router.use(requireAuth);

router.get(
  "/",
  validate({ query: listRollsQuerySchema }),
  asyncHandler(materialRollsController.list),
);
router.get("/:id", asyncHandler(materialRollsController.get));
router.post(
  "/",
  canWrite,
  validate({ body: createRollSchema }),
  asyncHandler(materialRollsController.create),
);
router.patch(
  "/:id",
  canWrite,
  validate({ body: updateRollSchema }),
  asyncHandler(materialRollsController.update),
);
router.delete("/:id", canWrite, asyncHandler(materialRollsController.remove));

export default router;
