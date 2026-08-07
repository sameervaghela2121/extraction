import { Router } from "express";
import cors from "cors";
import { publicGrnController } from "../controllers/publicGrn.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { validate } from "../middleware/validate.middleware";
import { updateGrnStatusSchema } from "../validators/grn.validators";

const router = Router();

// Deliberately public: no requireAuth, and CORS opened wide here specifically — the
// app-wide cors() in app.ts only allows the portal's own frontend origin, but this
// endpoint exists precisely so other, non-portal clients can call it directly.
router.use(cors());

// "/" must stay above "/:id" or the literal path would be swallowed by the param route.
router.get("/", asyncHandler(publicGrnController.list));
router.get("/:id", asyncHandler(publicGrnController.detail));
router.get("/:id/file", asyncHandler(publicGrnController.file));
router.patch(
  "/:id",
  validate({ body: updateGrnStatusSchema }),
  asyncHandler(publicGrnController.updateGrnStatus),
);

export default router;
