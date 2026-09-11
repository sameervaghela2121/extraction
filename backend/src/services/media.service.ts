import crypto from "crypto";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";

const storage = new Storage();
const bucket = storage.bucket(env.gcsBucket);

/**
 * Long enough that a photo stays viewable through a whole shift without re-fetching,
 * short enough that a leaked URL stops working. Read URLs are minted on demand, never
 * stored — which is why the database holds object paths, not URLs.
 */
const READ_URL_TTL_MS = 12 * 60 * 60 * 1000;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

/**
 * Object path for a roll photo, partitioned by date.
 *
 * The filename is random, not derived from what the phone sent: two operators
 * photographing two different rolls both produce "IMG_0001.jpg", and a name-derived path
 * would have the second silently overwrite the first.
 */
function buildObjectPath(mimetype: string, originalName: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const extension =
    EXTENSION_BY_MIME[mimetype] ?? (path.extname(originalName).toLowerCase().slice(0, 8) || ".bin");
  return `rolls/${year}/${month}/${crypto.randomUUID()}${extension}`;
}

/**
 * Signing fails for the same reason on every object — almost always missing or unusable
 * credentials — so a page of 25 rolls would otherwise log one identical error per photo.
 * Once a minute is enough to notice it without burying everything else.
 */
let lastSigningLog = 0;
const SIGNING_LOG_INTERVAL_MS = 60_000;

function logSigningFailure(objectPath: string, err: unknown): void {
  const now = Date.now();
  if (now - lastSigningLog < SIGNING_LOG_INTERVAL_MS) return;
  lastSigningLog = now;
  logger.error(
    `[media] could not sign a read URL for gs://${env.gcsBucket}/${objectPath} — photos render as missing until this is fixed:`,
    (err as Error).message,
  );
}

export const mediaService = {
  /** Uploads the buffer and returns the stored object path — not a URL. */
  async upload(file: { buffer: Buffer; mimetype: string; originalname: string }) {
    const objectPath = buildObjectPath(file.mimetype, file.originalname);

    try {
      await bucket.file(objectPath).save(file.buffer, {
        contentType: file.mimetype,
        resumable: false, // single small object; resumable adds a round-trip for no gain
        metadata: { cacheControl: "private, max-age=3600" },
      });
    } catch (err) {
      const status = (err as { code?: number }).code;
      // A storage misconfiguration is ours, not the caller's — but it has to be legible
      // rather than arriving as a generic 500 twenty seconds later.
      logger.error(
        `[media] upload to gs://${env.gcsBucket}/${objectPath} failed (${status}):`,
        (err as Error).message,
      );
      if (status === 403) {
        throw new ApiError(
          502,
          "File storage rejected the upload — the service account cannot write to the bucket",
        );
      }
      if (status === 404) {
        throw new ApiError(502, `File storage bucket "${env.gcsBucket}" was not found`);
      }
      throw new ApiError(502, "The photo could not be stored. Please try again.");
    }

    return objectPath;
  },

  /**
   * A time-limited read URL for a stored object. Throws if it cannot be minted.
   *
   * Signing is local crypto only when the credentials carry a private key — which is what
   * Cloud Run's runtime service account provides. Under user ADC there is no key, so the
   * library falls back to the IAM signBlob API and each URL becomes a network call. That
   * is also why this fails outright on a machine with no credentials at all.
   *
   * Left strict for the upload response: a URL that cannot be minted there means the
   * storage setup is wrong, and the caller should hear about it rather than be handed a
   * success with a hole in it.
   */
  async signedReadUrl(objectPath: string): Promise<string> {
    const [url] = await bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + READ_URL_TTL_MS,
    });
    return url;
  },

  /**
   * The same URL, for a response that only renders it — where a failure must not take the
   * rest of the payload down with it.
   *
   * A roll list is weights, locations and statuses; a movement list is a stock ledger.
   * Neither stops being worth reading because a photo cannot be signed, yet one unsignable
   * path used to return 500 for the whole page. Null instead — the value these responses
   * already carry for a photo slot that was never filled, so no client meets a shape it
   * was not already handling.
   */
  async signedReadUrlOrNull(objectPath?: string | null): Promise<string | null> {
    if (!objectPath) return null;
    try {
      return await this.signedReadUrl(objectPath);
    } catch (err) {
      logSigningFailure(objectPath, err);
      return null;
    }
  },
};
