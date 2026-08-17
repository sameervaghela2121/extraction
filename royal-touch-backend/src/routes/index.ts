import { Router } from "express";
import authRoutes from "./auth.routes";
import materialsRoutes from "./materials.routes";
import rollsRoutes from "./rolls.routes";
import mediaRoutes from "./media.routes";
import lookupsRoutes from "./lookups.routes";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));

router.use("/auth", authRoutes);
router.use("/materials", materialsRoutes);
router.use("/rolls", rollsRoutes);
router.use("/media", mediaRoutes);
// Master-data lists: /locations, /batches, /clients, /suppliers.
router.use("/", lookupsRoutes);

export default router;
