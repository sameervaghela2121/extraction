import { Router } from "express";
import authRoutes from "./auth.routes";
import uploadsRoutes from "./uploads.routes";
import documentsRoutes from "./documents.routes";
import fieldDefinitionsRoutes from "./fieldDefinitions.routes";
import usersRoutes from "./users.routes";
import exportRoutes from "./export.routes";
import grnRoutes from "./grn.routes";
import publicGrnRoutes from "./publicGrn.routes";
import generalVouchersRoutes from "./generalVouchers.routes";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));

router.use("/auth", authRoutes);
// Deliberately public (see publicGrn.routes.ts) — must be mounted before the "/"
// catch-all below, whose uploadsRoutes applies requireAuth unscoped to every path that
// reaches it. Mounting this after that line would silently force auth onto it too.
router.use("/public/grn", publicGrnRoutes);
// Upload/scan routes (POST /documents/upload, /scan-sessions) mounted before /documents
// so the upload path is matched first.
router.use("/", uploadsRoutes);
router.use("/documents", documentsRoutes);
router.use("/field-definitions", fieldDefinitionsRoutes);
router.use("/users", usersRoutes);
router.use("/export", exportRoutes);
router.use("/grn", grnRoutes);
router.use("/general-vouchers", generalVouchersRoutes);

export default router;
