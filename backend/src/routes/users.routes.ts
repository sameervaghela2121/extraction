import { Router } from "express";
import { usersController } from "../controllers/users.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { inviteUserSchema, updateUserSchema } from "../validators/users.validators";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/", asyncHandler(usersController.list));
router.post("/invite", validate({ body: inviteUserSchema }), asyncHandler(usersController.invite));
router.patch("/:id", validate({ body: updateUserSchema }), asyncHandler(usersController.update));
router.delete("/:id", asyncHandler(usersController.remove));

export default router;
