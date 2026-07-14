import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  loginSchema,
  refreshSchema,
  acceptInviteBodySchema,
  acceptInviteParamsSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validators/auth.validators";

const router = Router();

router.post("/login", validate({ body: loginSchema }), asyncHandler(authController.login));
router.post("/refresh", validate({ body: refreshSchema }), asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));
router.post(
  "/invite/:token/accept",
  validate({ params: acceptInviteParamsSchema, body: acceptInviteBodySchema }),
  asyncHandler(authController.acceptInvite),
);
router.get("/me", requireAuth, asyncHandler(authController.me));
router.post(
  "/forgot-password",
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword),
);
router.post(
  "/reset-password",
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword),
);

export default router;
