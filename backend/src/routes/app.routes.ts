import { Router } from "express";
import { appController } from "../controllers/app.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.use(requireAuth);

// A signed GCS URL, not the file itself — the frontend redirects to it, which is what
// actually triggers the browser's own download with no Drive-style confirmation page in
// the way. Requiring auth here (unlike the URL itself, which needs none — the signature
// is what authorizes it) keeps this consistent with every other endpoint in the app rather
// than carving out one public route for the sake of a plain <a href>.
router.get("/apk", asyncHandler(appController.apkDownloadUrl));

export default router;
