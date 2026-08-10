import { Router } from "express";
import cors from "cors";
import { publicGrnController } from "../controllers/publicGrn.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { validate } from "../middleware/validate.middleware";
import { updateGrnStatusSchema } from "../validators/grn.validators";
import { requireApiKey } from "../tokens/apiKey.middleware";

const router = Router();

// No portal login (requireAuth) — but no longer wide open either: every request here
// must carry a valid, non-revoked key in the df-api-key header (see tokens/ApiToken.model.ts).
// CORS is opened wide here specifically — the app-wide cors() in app.ts only allows the
// portal's own frontend origin, but this endpoint exists precisely so other, non-portal
// clients can call it directly.
router.use(cors());
router.use(asyncHandler(requireApiKey));

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
