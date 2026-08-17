import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4100),
  nodeEnv: process.env.NODE_ENV ?? "development",

  mongodbUri: required("MONGODB_URI"),
  // Deliberately NOT the portal's "Data" database. Rolls, materials and employees share
  // nothing with invoices/GRNs — separate DB keeps the two products independently
  // restorable and stops a stray query from crossing products.
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "RoyalTouch",

  // Must differ from the portal's secrets: a portal token must not authenticate here,
  // and vice versa.
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),

  // Its own bucket, not the portal's: these are shop-floor roll photos, unrelated to
  // invoice documents, with a different retention story.
  gcsBucket: process.env.GCS_BUCKET ?? "sameerv-royaltouch-rolls",
  // A phone camera photo, not a document scan. 15MB covers a 12MP JPEG comfortably.
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
};
