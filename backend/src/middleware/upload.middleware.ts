import multer from "multer";

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
