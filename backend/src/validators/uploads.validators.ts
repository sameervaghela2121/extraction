import { z } from "zod";

const ALLOWED_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

const purposeSchema = z.enum(["invoice", "grn"]).default("invoice");
const sourceSchema = z.enum(["upload", "scan"]).default("upload");

export const presignSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        mimetype: z.enum(ALLOWED_MIMES),
      }),
    )
    .min(1, "Provide at least one file")
    .max(20, "Up to 20 files per upload"),
});

// No `files` field: which GCS objects this job covers is looked up server-side from what
// presign() recorded, never taken from the client — see PendingUpload.model.ts.
export const confirmUploadSchema = z.object({
  jobId: z.string().min(1),
  purpose: purposeSchema,
  source: sourceSchema,
});
