import { Router } from "express";
import { usersController } from "../controllers/users.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin, requireRole } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createUserSchema,
  inviteUserSchema,
  searchUsersSchema,
  setPasswordSchema,
  updateUserSchema,
} from "../validators/users.validators";

const router = Router();

router.use(requireAuth);

// Shared with godown_supervisor, who manages the operators under them. Which accounts a
// supervisor may add, edit or set a password for is enforced in usersService, not here (a
// route gate can't see the request body or the target account). Deleting stays admin-only.
const canManage = requireRole("admin", "godown_supervisor");

router.get("/", canManage, asyncHandler(usersController.list));
// The paged list the admin panel uses; same access and same godown-only boundary as GET.
router.post("/search", canManage, validate({ body: searchUsersSchema }), asyncHandler(usersController.search));
// Add a user with a password, active at once — no email. Which roles may be added and
// whose password may be set are checked in the service (it needs the target's role).
router.post("/", canManage, validate({ body: createUserSchema }), asyncHandler(usersController.create));
router.post("/:id/password", canManage, validate({ body: setPasswordSchema }), asyncHandler(usersController.setPassword));
router.post("/invite", canManage, validate({ body: inviteUserSchema }), asyncHandler(usersController.invite));
// Supervisors may edit operators too — which accounts each role may edit is checked in the service.
router.patch("/:id", canManage, validate({ body: updateUserSchema }), asyncHandler(usersController.update));
router.delete("/:id", requireAdmin, asyncHandler(usersController.remove));

export default router;
