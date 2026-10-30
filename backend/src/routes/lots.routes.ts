import { Router } from "express";
import { lotsController } from "../controllers/lots.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireGodownWrite } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { createLotSchema, listLotsQuerySchema } from "../validators/lots.validators";

const router = Router();

router.use(requireAuth);

router.get("/", validate({ query: listLotsQuerySchema }), asyncHandler(lotsController.list));
router.get("/:id", asyncHandler(lotsController.get));
// Same people who register rolls create the lots they arrive in.
router.post("/", requireGodownWrite, validate({ body: createLotSchema }), asyncHandler(lotsController.create));

export default router;
