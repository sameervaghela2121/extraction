import { Router } from "express";
import authRoutes from "./auth.routes";
import uploadsRoutes from "./uploads.routes";
import documentsRoutes from "./documents.routes";
import fieldDefinitionsRoutes from "./fieldDefinitions.routes";
import usersRoutes from "./users.routes";
import exportRoutes from "./export.routes";
import webhooksRoutes from "./webhooks.routes";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));

router.use("/auth", authRoutes);
// Upload/scan routes (POST /documents/upload, /scan-sessions, /inbound-email-address) mounted
// before /documents so the upload path is matched first.
router.use("/", uploadsRoutes);
router.use("/documents", documentsRoutes);
router.use("/field-definitions", fieldDefinitionsRoutes);
router.use("/users", usersRoutes);
router.use("/export", exportRoutes);
router.use("/webhooks", webhooksRoutes);

export default router;
