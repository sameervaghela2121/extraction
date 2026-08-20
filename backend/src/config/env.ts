import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",

  mongodbUri: required("MONGODB_URI"),
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "Data",
  filesCollection: process.env.MONGO_FILES_COLLECTION ?? "Files",
  invoiceCollection: process.env.MONGO_INVOICE_COLLECTION ?? "Invoice",

  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),

  invoiceGeneratorBaseUrl: process.env.INVOICE_GENERATOR_BASE_URL ?? "http://localhost:8000",
  invoiceGeneratorAppUser: process.env.INVOICE_GENERATOR_APP_USER ?? "",
  invoiceGeneratorAppPassword: process.env.INVOICE_GENERATOR_APP_PASSWORD ?? "",

  gcsBucket: process.env.GCS_BUCKET ?? "sameerv-docflow-invoices",

  // OCR: Google Vision reads curved/dirty labels far better than local tesseract, but
  // costs per call. Unset key = tesseract, which needs no credentials and no network.
  googleVisionApiKey: process.env.GOOGLE_VISION_API_KEY ?? "",
  // "auto" tries easyocr (the Python service), then Vision if a key is set, then local
  // tesseract. Name one explicitly to pin a single engine, e.g. while testing.
  ocrEngine: process.env.OCR_ENGINE ?? "auto",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024),

  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",

  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.MAIL_FROM ?? "no-reply@docflow.app",
  },
};
