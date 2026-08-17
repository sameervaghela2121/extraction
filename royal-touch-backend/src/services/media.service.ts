import crypto from "crypto";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { env } from "../config/env";

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

export const mediaService = {
  /** Uploads the buffer and returns the stored object path — not a URL. */
  async upload(file: { buffer: Buffer; mimetype: string; originalname: string }) {
    const objectPath = buildObjectPath(file.mimetype, file.originalname);

    await bucket.file(objectPath).save(file.buffer, {
      contentType: file.mimetype,
      resumable: false, // single small object; resumable adds a round-trip for no gain
      metadata: { cacheControl: "private, max-age=3600" },
    });

    return objectPath;
  },

  /**
   * A time-limited read URL for a stored object.
   *
   * Signing is local crypto — no network call — so minting these per response is cheap
   * enough to do on every roll detail request.
   */
  async signedReadUrl(objectPath: string): Promise<string> {
    const [url] = await bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + READ_URL_TTL_MS,
    });
    return url;
  },

  /** Convenience for the roll responses, which carry four optional photos. */
  async signedReadUrlOrNull(objectPath?: string | null): Promise<string | null> {
    return objectPath ? this.signedReadUrl(objectPath) : null;
  },
};
