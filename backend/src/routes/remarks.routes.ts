import { Router } from "express";
import { remarksController } from "../controllers/remarks.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createRemarkSchema,
  updateRemarkSchema,
  listRemarksQuerySchema,
} from "../validators/remarks.validators";

const router = Router();

// Same gating as the other masters: any signed-in user can read the list to fill a
// picker, the godown roles and admin maintain it.
const canWrite = requireGodownWrite;

router.use(requireAuth);

router.get("/", validate({ query: listRemarksQuerySchema }), asyncHandler(remarksController.list));
router.get("/:id", asyncHandler(remarksController.get));
router.post(
  "/",
  canWrite,
  validate({ body: createRemarkSchema }),
  asyncHandler(remarksController.create),
);
router.patch(
  "/:id",
  canWrite,
  validate({ body: updateRemarkSchema }),
  asyncHandler(remarksController.update),
);
router.delete("/:id", canWrite, asyncHandler(remarksController.remove));

export default router;
