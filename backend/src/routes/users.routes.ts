import { Router } from "express";
import { usersController } from "../controllers/users.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin, requireRole } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { inviteUserSchema, updateUserSchema } from "../validators/users.validators";

const router = Router();

router.use(requireAuth);

// List and invite are shared with godown_supervisor — they invite the operators under
// them, so need to see this panel too. What role they're allowed to invite is enforced in
// usersService.invite, not here (a route gate can't see the request body). Role/status
// changes on an existing account stay admin-only.
const canManage = requireRole("admin", "godown_supervisor");

router.get("/", canManage, asyncHandler(usersController.list));
router.post("/invite", canManage, validate({ body: inviteUserSchema }), asyncHandler(usersController.invite));
router.patch("/:id", requireAdmin, validate({ body: updateUserSchema }), asyncHandler(usersController.update));
router.delete("/:id", requireAdmin, asyncHandler(usersController.remove));

export default router;
