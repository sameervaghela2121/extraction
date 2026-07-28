import { Router } from "express";
import { grnController } from "../controllers/grn.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  saveGrnSchema,
  draftQuerySchema,
  listQuerySchema,
  statusSchema,
  updateQuantitiesSchema,
} from "../validators/grn.validators";

const router = Router();

// No admin gate at this level — capturing a GRN (draft/save/list/detail) is open to
// staff and admin alike. Approve/reject and quantity edits are each gated below instead,
// to opposite roles: deciding is admin-only, correcting a received count is staff-only.
router.use(requireAuth);

// "/draft" must stay above "/:id" or the literal path is swallowed by the param route.
router.get("/draft", validate({ query: draftQuerySchema }), asyncHandler(grnController.draft));
router.get("/", validate({ query: listQuerySchema }), asyncHandler(grnController.list));
router.post("/", validate({ body: saveGrnSchema }), asyncHandler(grnController.save));
router.get("/:id", asyncHandler(grnController.detail));
router.patch(
  "/:id/status",
  requireRole("admin"),
  validate({ body: statusSchema }),
  asyncHandler(grnController.setStatus),
);
// Staff-only: see the comment on grnService.updateQuantities for why admins aren't gated in here too.
router.patch(
  "/:id/quantities",
  requireRole("staff"),
  validate({ body: updateQuantitiesSchema }),
  asyncHandler(grnController.updateQuantities),
);

export default router;
