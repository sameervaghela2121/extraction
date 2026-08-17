import { Router } from "express";
import { lookupsController } from "../controllers/lookups.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { lookupQuerySchema, batchQuerySchema } from "../validators/lookups.validators";

/**
 * Master-data lists for the app's dropdowns. Mounted at the root of /v1 rather than under
 * a /lookups prefix, because the API doc addresses them as top-level resources — and they
 * are: /clients is what the issue screen posts against.
 */
const router = Router();

// Auth is attached per route, not via router.use(requireAuth). This router is mounted at
// "/" so every unmatched path in the API reaches it — a router-level guard would answer
// 401 for a simple typo'd URL that should be a 404.
const query = validate({ query: lookupQuerySchema });

router.get("/locations", requireAuth, query, asyncHandler(lookupsController.locations));
router.get(
  "/batches",
  requireAuth,
  validate({ query: batchQuerySchema }),
  asyncHandler(lookupsController.batches),
);
router.get("/clients", requireAuth, query, asyncHandler(lookupsController.clients));
router.get("/suppliers", requireAuth, query, asyncHandler(lookupsController.suppliers));

export default router;
