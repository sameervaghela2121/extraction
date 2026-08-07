import { Router } from "express";
import { generalVouchersController } from "../controllers/generalVouchers.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateFieldsSchema, bulkSchema } from "../validators/generalVouchers.validators";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(generalVouchersController.list));

// Bulk actions (declared before :id routes to avoid path collisions)
router.post("/bulk/verify", validate({ body: bulkSchema }), asyncHandler(generalVouchersController.bulkVerify));
router.post("/bulk/unverify", validate({ body: bulkSchema }), asyncHandler(generalVouchersController.bulkUnverify));
router.post("/bulk/archive", validate({ body: bulkSchema }), asyncHandler(generalVouchersController.bulkArchive));

router.get("/:id", asyncHandler(generalVouchersController.detail));
router.get("/:id/activity", asyncHandler(generalVouchersController.activity));
router.get("/:id/file", asyncHandler(generalVouchersController.file));
router.patch(
  "/:id/fields",
  validate({ body: updateFieldsSchema }),
  asyncHandler(generalVouchersController.updateFields),
);
router.post("/:id/verify", asyncHandler(generalVouchersController.verify));
router.post("/:id/unverify", asyncHandler(generalVouchersController.unverify));
router.post("/:id/archive", asyncHandler(generalVouchersController.archive));
router.post("/:id/restore", asyncHandler(generalVouchersController.restore));

export default router;
