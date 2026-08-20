import multer from "multer";
import { env } from "../config/env";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** In-memory multipart handling — files are forwarded straight to the extraction service, never stored locally. */
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, JPG, PNG, WEBP`));
  },
});

// Images only, one at a time. Every roll photo is a phone camera capture — the tag, the
// stitched barcode, and the two sides. The registration flow uploads them one per
// request so a failed shot is retried alone rather than the whole set.
const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, HEIC`));
  },
});
