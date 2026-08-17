import { Router } from "express";
import { materialsController } from "../controllers/materials.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  listMaterialsQuerySchema,
  materialIdParamsSchema,
} from "../validators/materials.validators";

const router = Router();

// Every material route needs a token — unlike /auth, which is how a token is obtained.
router.use(requireAuth);

router.get(
  "/",
  validate({ query: listMaterialsQuerySchema }),
  asyncHandler(materialsController.list),
);
router.get(
  "/:materialId",
  validate({ params: materialIdParamsSchema }),
  asyncHandler(materialsController.detail),
);

export default router;
