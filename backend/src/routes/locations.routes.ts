import { Router } from "express";
import { locationsController } from "../controllers/locations.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createLocationSchema,
  updateLocationSchema,
  listLocationsQuerySchema,
} from "../validators/locations.validators";

const router = Router();

// Same gating as the other masters: any signed-in user can read the list to fill a
// picker, admin and store_manager maintain it.
const canWrite = requireGodownWrite;

router.use(requireAuth);

router.get(
  "/",
  validate({ query: listLocationsQuerySchema }),
  asyncHandler(locationsController.list),
);
router.get("/:id", asyncHandler(locationsController.get));
router.post(
  "/",
  canWrite,
  validate({ body: createLocationSchema }),
  asyncHandler(locationsController.create),
);
router.patch(
  "/:id",
  canWrite,
  validate({ body: updateLocationSchema }),
  asyncHandler(locationsController.update),
);
router.delete("/:id", canWrite, asyncHandler(locationsController.remove));

export default router;
