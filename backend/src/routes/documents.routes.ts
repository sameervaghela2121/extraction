import { Router } from "express";
import { documentsController } from "../controllers/documents.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateFieldsSchema, bulkSchema } from "../validators/documents.validators";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(documentsController.list));

// Bulk actions (declared before :id routes to avoid path collisions)
router.post("/bulk/verify", validate({ body: bulkSchema }), asyncHandler(documentsController.bulkVerify));
router.post("/bulk/unverify", validate({ body: bulkSchema }), asyncHandler(documentsController.bulkUnverify));
router.post("/bulk/archive", validate({ body: bulkSchema }), asyncHandler(documentsController.bulkArchive));

router.get("/:id", asyncHandler(documentsController.detail));
router.get("/:id/activity", asyncHandler(documentsController.activity));
router.get("/:id/file", asyncHandler(documentsController.file));
router.patch(
  "/:id/fields",
  validate({ body: updateFieldsSchema }),
  asyncHandler(documentsController.updateFields),
);
router.post("/:id/verify", asyncHandler(documentsController.verify));
router.post("/:id/unverify", asyncHandler(documentsController.unverify));
router.post("/:id/archive", asyncHandler(documentsController.archive));
router.post("/:id/restore", asyncHandler(documentsController.restore));

export default router;
