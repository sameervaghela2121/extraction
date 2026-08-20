import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { AxiosError } from "axios";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";

const DUPLICATE_KEY = 11000;

/** Turn a field name into something readable in a sentence: roll_number -> "roll number". */
function humanise(field: string): string {
  return field.replace(/_/g, " ");
}

/** A unique-index violation is a 409 the user can act on, not a crash. Services check
 *  for duplicates before writing, but the index is what actually wins a race — this is
 *  where that outcome gets reported honestly. */
function duplicateKeyMessage(err: mongoose.mongo.MongoServerError): string {
  const [field, value] = Object.entries(err.keyValue ?? {})[0] ?? [];
  if (!field) return "That value is already in use";
  return `${value} is already in use — pick a different ${humanise(field)}`;
}

/** body-parser rejections arrive as plain Errors carrying `type` and `status`. */
function bodyParserResponse(err: { type?: string; status?: number }) {
  if (err.type === "entity.parse.failed") {
    return { status: 400, error: "The request body is not valid JSON" };
  }
  if (err.type === "entity.too.large") {
    return { status: 413, error: "That upload is too large" };
  }
  return undefined;
}

/**
 * Map every failure we can name to a status the caller can act on. Anything that reaches
 * the bottom is a genuine bug: it gets logged with the route that produced it, and the
 * user gets a plain apology rather than a stack trace or an internal identifier.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No endpoint at ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Deliberate, already-worded failures from the services.
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message, details: err.details });
    return;
  }

  // ---- Database ----
  if (err instanceof mongoose.mongo.MongoServerError && err.code === DUPLICATE_KEY) {
    res.status(409).json({ error: duplicateKeyMessage(err) });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    // Schema-level failures that got past the request validator (or a service writing
    // directly). Report the first field's own message rather than Mongoose's stack.
    const first = Object.values(err.errors)[0];
    res.status(400).json({ error: first?.message ?? "Some values are not valid" });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: `"${err.value}" is not a valid ${humanise(err.path)}` });
    return;
  }
  // The database itself is unreachable — retryable, so 503 rather than 500.
  if (
    err instanceof mongoose.Error.MongooseServerSelectionError ||
    (err instanceof Error && err.name === "MongoNetworkError")
  ) {
    logger.error(`Database unreachable on ${req.method} ${req.originalUrl}:`, err);
    res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
    return;
  }

  // ---- Uploads ----
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error && err.message.startsWith("Unsupported file type")) {
    res.status(400).json({ error: err.message });
    return;
  }
  const bodyParser = bodyParserResponse(err as { type?: string; status?: number });
  if (bodyParser) {
    res.status(bodyParser.status).json({ error: bodyParser.error });
    return;
  }

  // ---- Upstream services (extraction API, GCS) ----
  if (err instanceof AxiosError) {
    logger.error(`Upstream call failed on ${req.method} ${req.originalUrl}:`, err.message);
    // No response at all means a timeout or a dead host — distinct from an upstream
    // that answered with an error, and the difference tells the user whether to retry.
    const timedOut = !err.response;
    res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? "The extraction service did not respond in time. Please try again."
        : "The extraction service could not process that request.",
    });
    return;
  }

  // ---- Anything left is a bug on our side ----
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}
