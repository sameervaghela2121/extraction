import { Router } from "express";
import authRoutes from "./auth.routes";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));

router.use("/auth", authRoutes);
// Modules to come: /materials, /rolls, /media, /locations, /batches.

export default router;
