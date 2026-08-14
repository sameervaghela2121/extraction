import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { validate } from "../middleware/validate.middleware";
import { loginSchema, refreshSchema } from "../validators/auth.validators";

const router = Router();

// All three are unauthenticated by design: they are how a token is obtained,
// renewed, and discarded.
router.post("/login", validate({ body: loginSchema }), asyncHandler(authController.login));
router.post("/refresh", validate({ body: refreshSchema }), asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));

export default router;
