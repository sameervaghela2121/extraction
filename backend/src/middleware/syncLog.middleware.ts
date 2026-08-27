import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { SyncLog, type ISyncLogItem } from "../models/SyncLog.model";
import { logger } from "../utils/logger";

/**
 * Records every POST /sync/batch to the sync_logs collection.
 *
 * Sits in front of validate(), not inside the service, so a batch rejected for a bad
 * field is logged too — those are the ones worth seeing, because the device gets a 400
 * and the service never runs, so nothing else would remember what arrived.
 *
 * Wrapping res.json is the only hook that catches both paths: the controller's success
 * response and the error handler's failure response both go through it.
 */

type BatchResponse = {
  applied?: number;
  failed?: number;
  skipped?: number;
  resume_from?: number | null;
  results?: Array<{
    index: number;
    type: string;
    client_id: string;
    status: string;
    data?: { id?: string };
    code?: number;
    reason?: string;
    error?: string;
  }>;
  error?: string;
};

/** The response's per-item verdicts, plus the id each written item produced. */
function toLogItems(body: BatchResponse): ISyncLogItem[] | undefined {
  return body.results?.map((r) => ({
    index: r.index,
    type: r.type,
    client_id: r.client_id,
    status: r.status,
    server_id: r.data?.id,
    code: r.code,
    reason: r.reason,
    error: r.error,
  }));
}

export function logSyncBatch(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  // Captured before validate() runs: it replaces req.body with the parsed result, and on
  // a rejection the raw body is what we need to see.
  const requestBody = req.body;
  const items = Array.isArray(requestBody?.items) ? requestBody.items : [];
  const json = res.json.bind(res);

  res.json = (body: BatchResponse) => {
    // Fire and forget. A log write must never delay the flush or, worse, fail it — the
    // device is waiting and the work is already committed.
    SyncLog.create({
      user_id: req.auth?.userId ? new Types.ObjectId(req.auth.userId) : undefined,
      ip: req.ip,
      status_code: res.statusCode,
      item_count: items.length,
      applied: body?.applied ?? 0,
      failed: body?.failed ?? 0,
      skipped: body?.skipped ?? 0,
      resume_from: body?.resume_from ?? null,
      request_body: requestBody,
      results: toLogItems(body ?? {}),
      // Only set when the whole request failed — a per-item error lives on its result row.
      error: body?.results ? undefined : body?.error,
      duration_ms: Date.now() - started,
    }).catch((err) => logger.error("[sync] could not write sync log:", err));

    return json(body);
  };

  next();
}
