import { Router } from "express";
import { fieldDefinitionsController } from "../controllers/fieldDefinitions.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { toggleFieldSchema, addCustomFieldSchema } from "../validators/fieldDefinitions.validators";

const router = Router();

router.use(requireAuth);

// Any authenticated user can read the field list — Documents, Export, and the detail
// page all need it just to know what columns exist. Only admins can change it.
router.get("/", asyncHandler(fieldDefinitionsController.list));
router.post(
  "/",
  requireAdmin,
  validate({ body: addCustomFieldSchema }),
  asyncHandler(fieldDefinitionsController.addCustom),
);
router.patch(
  "/:fieldKey",
  requireAdmin,
  validate({ body: toggleFieldSchema }),
  asyncHandler(fieldDefinitionsController.toggle),
);
router.delete("/:fieldKey", requireAdmin, asyncHandler(fieldDefinitionsController.remove));

export default router;
