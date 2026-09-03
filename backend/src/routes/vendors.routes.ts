import { Router } from "express";
import { vendorsController } from "../controllers/vendors.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createVendorSchema,
  updateVendorSchema,
  listVendorsQuerySchema,
} from "../validators/vendors.validators";

const router = Router();

// Reads are open to any signed-in user — every module needs the vendor list to
// populate pickers. Writes belong to whoever maintains master data: admin on the
// web, store_manager on mobile.
const canWrite = requireGodownWrite;

router.use(requireAuth);

router.get("/", validate({ query: listVendorsQuerySchema }), asyncHandler(vendorsController.list));
router.get("/:id", asyncHandler(vendorsController.get));
router.post(
  "/",
  canWrite,
  validate({ body: createVendorSchema }),
  asyncHandler(vendorsController.create),
);
router.patch(
  "/:id",
  canWrite,
  validate({ body: updateVendorSchema }),
  asyncHandler(vendorsController.update),
);
router.delete("/:id", canWrite, asyncHandler(vendorsController.remove));

export default router;
