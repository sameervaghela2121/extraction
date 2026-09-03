import { Router } from "express";
import { syncController } from "../controllers/sync.controller";
import { syncLogsController } from "../controllers/syncLogs.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite, requireRole } from "../middleware/rbac.middleware";
import { logSyncBatch } from "../middleware/syncLog.middleware";
import { validate } from "../middleware/validate.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { syncBatchSchema } from "../validators/sync.validators";
import { listSyncLogsQuerySchema } from "../validators/syncLogs.validators";

const router = Router();

router.use(requireAuth);

// Same roles as the single-item endpoints this delegates to. Gating here as well means a
// read-only account is refused before any item runs, not partway through the batch.
router.post(
  "/batch",
  requireGodownWrite,
  // Before validate(), so a batch rejected for a bad field is recorded too — the device
  // gets a 400 and the service never runs, so this is the only trace of what arrived.
  logSyncBatch,
  validate({ body: syncBatchSchema }),
  asyncHandler(syncController.flush),
);

// Our own view of what the devices have been sending. Admin only — a flush log carries
// every field of every queued write, which is more than a store manager needs.
router.get(
  "/logs",
  requireRole("admin"),
  validate({ query: listSyncLogsQuerySchema }),
  asyncHandler(syncLogsController.list),
);
router.get("/logs/:id", requireRole("admin"), asyncHandler(syncLogsController.get));

export default router;
