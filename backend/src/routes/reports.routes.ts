import { Router } from "express";
import { reportsController } from "../controllers/reports.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { consumptionReportQuerySchema, dailyRollReportQuerySchema } from "../validators/reports.validators";

const router = Router();

// The same reach as the portal's godown screens: the supervisor (and super_admin, who passes
// every check).
router.use(requireAuth, requireRole("godown_supervisor"));

router.get(
  "/daily-rolls/count",
  validate({ query: dailyRollReportQuerySchema }),
  asyncHandler(reportsController.dailyRollsCount),
);
router.get(
  "/daily-rolls",
  validate({ query: dailyRollReportQuerySchema }),
  asyncHandler(reportsController.dailyRolls),
);
router.get(
  "/consumption",
  validate({ query: consumptionReportQuerySchema }),
  asyncHandler(reportsController.consumption),
);
router.get(
  "/consumption/summary.csv",
  validate({ query: consumptionReportQuerySchema }),
  asyncHandler(reportsController.consumptionCsv),
);
router.get(
  "/consumption/detail.csv",
  validate({ query: consumptionReportQuerySchema }),
  asyncHandler(reportsController.consumptionDetailCsv),
);

export default router;
