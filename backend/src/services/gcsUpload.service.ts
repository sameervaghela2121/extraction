import path from "path";
import { Storage } from "@google-cloud/storage";
import { env } from "../config/env";

const storage = new Storage();
const bucket = storage.bucket(env.gcsBucket);

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
const INCOMING_PREFIX = "incoming";

/** Mirrors the Python service's `re.sub(r"[^A-Za-z0-9._-]", "_", ...)` so both sides
 *  produce the same safe object-name shape for a given filename. */
function sanitizeFilename(filename: string): string {
  const base = path.basename(filename || "file");
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe || "file";
}

export interface PresignedUpload {
  idx: number;
  filename: string;
  mimetype: string;
  objectPath: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/** Mints one v4 signed PUT URL per requested file, all staged under
 *  `incoming/<jobId>/<idx>_<safeFilename>` — a temporary intake location; the
 *  extraction service downloads from here and writes the canonical copy itself. */
export async function presignUploads(
  jobId: string,
  files: Array<{ filename: string; mimetype: string }>,
): Promise<PresignedUpload[]> {
  const sizeRange = `0,${env.maxUploadBytes}`;
  return Promise.all(
    files.map(async (f, i) => {
      const idx = i + 1;
      const objectPath = `${INCOMING_PREFIX}/${jobId}/${idx}_${sanitizeFilename(f.filename)}`;
      const [uploadUrl] = await bucket.file(objectPath).getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + SIGNED_URL_TTL_MS,
        contentType: f.mimetype,
        extensionHeaders: { "x-goog-content-length-range": sizeRange },
      });
      return {
        idx,
        filename: f.filename,
        mimetype: f.mimetype,
        objectPath,
        uploadUrl,
        headers: {
          "Content-Type": f.mimetype,
          "x-goog-content-length-range": sizeRange,
        },
      };
    }),
  );
}

/** The real size of a confirmed upload, read back from GCS itself — never trust a
 *  client-reported size. Returns null if the object was never actually PUT there. */
export async function getObjectSize(objectPath: string): Promise<number | null> {
  try {
    const [meta] = await bucket.file(objectPath).getMetadata();
    return Number(meta.size ?? 0);
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}
