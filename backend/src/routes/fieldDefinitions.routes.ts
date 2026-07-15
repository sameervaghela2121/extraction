import { Router } from "express";
import { fieldDefinitionsController } from "../controllers/fieldDefinitions.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  toggleFieldSchema,
  addCustomFieldSchema,
  reorderFieldsSchema,
} from "../validators/fieldDefinitions.validators";

const router = Router();

router.use(requireAuth);

// Any authenticated user can read the field list — Documents, Export, and the detail
// page all need it just to know what columns exist. Every mutation requires admin,
// including reorder: it rewrites the shared FieldDefinition.order used everywhere
// (Extraction Settings included), so a non-admin dragging columns on the Export page
// must not be able to silently reorder that global config for every other user.
router.get("/", asyncHandler(fieldDefinitionsController.list));
router.post(
  "/",
  requireAdmin,
  validate({ body: addCustomFieldSchema }),
  asyncHandler(fieldDefinitionsController.addCustom),
);
// Declared before /:fieldKey so "reorder" isn't swallowed as a :fieldKey value.
router.patch(
  "/reorder",
  requireAdmin,
  validate({ body: reorderFieldsSchema }),
  asyncHandler(fieldDefinitionsController.reorder),
);
router.patch(
  "/:fieldKey",
  requireAdmin,
  validate({ body: toggleFieldSchema }),
  asyncHandler(fieldDefinitionsController.toggle),
);
router.delete("/:fieldKey", requireAdmin, asyncHandler(fieldDefinitionsController.remove));

export default router;
