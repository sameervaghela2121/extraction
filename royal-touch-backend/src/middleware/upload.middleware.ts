import multer from "multer";
import { env } from "../config/env";

// Images only. Every media upload here is a phone camera capture — the roll tag, the
// stitched barcode, and the two sides. No PDFs, no documents.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

/**
 * In-memory multipart handling: the buffer is streamed straight to GCS and never touches
 * this container's disk, which is ephemeral on Cloud Run anyway.
 */
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, HEIC`));
  },
});
