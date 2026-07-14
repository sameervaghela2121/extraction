import { Router } from "express";
import { fieldDefinitionsController } from "../controllers/fieldDefinitions.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { toggleFieldSchema, addCustomFieldSchema } from "../validators/fieldDefinitions.validators";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/", asyncHandler(fieldDefinitionsController.list));
router.post("/", validate({ body: addCustomFieldSchema }), asyncHandler(fieldDefinitionsController.addCustom));
router.patch(
  "/:fieldKey",
  validate({ body: toggleFieldSchema }),
  asyncHandler(fieldDefinitionsController.toggle),
);
router.delete("/:fieldKey", asyncHandler(fieldDefinitionsController.remove));

export default router;
