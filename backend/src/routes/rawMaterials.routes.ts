import { Router } from "express";
import { rawMaterialsController } from "../controllers/rawMaterials.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createRawMaterialSchema,
  updateRawMaterialSchema,
  listRawMaterialsQuerySchema,
} from "../validators/rawMaterials.validators";

const router = Router();

// Same gating as vendors: any signed-in user can read the master list, admin and
// store_manager maintain it.
const canWrite = requireGodownWrite;

router.use(requireAuth);

router.get(
  "/",
  validate({ query: listRawMaterialsQuerySchema }),
  asyncHandler(rawMaterialsController.list),
);
router.get("/:id", asyncHandler(rawMaterialsController.get));
router.post(
  "/",
  canWrite,
  validate({ body: createRawMaterialSchema }),
  asyncHandler(rawMaterialsController.create),
);
router.patch(
  "/:id",
  canWrite,
  validate({ body: updateRawMaterialSchema }),
  asyncHandler(rawMaterialsController.update),
);
router.delete("/:id", canWrite, asyncHandler(rawMaterialsController.remove));

export default router;
