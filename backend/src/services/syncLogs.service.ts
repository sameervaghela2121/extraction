import { type FilterQuery } from "mongoose";
import { SyncLog, type ISyncLog } from "../models/SyncLog.model";
import { findOr404, paginated } from "../utils/crud";

/** The list view: everything except the payloads, which would make it unreadable. */
function toSummary(l: ISyncLog) {
  return {
    id: l._id.toString(),
    createdAt: l.createdAt,
    status_code: l.status_code,
    item_count: l.item_count,
    applied: l.applied,
    failed: l.failed,
    skipped: l.skipped,
    resume_from: l.resume_from,
    duration_ms: l.duration_ms,
    error: l.error,
    user_id: l.user_id?.toString(),
    ip: l.ip,
    // Enough to see what went wrong without opening the row.
    failures: (l.results ?? [])
      .filter((r) => r.status === "failed")
      .map((r) => ({ index: r.index, code: r.code, reason: r.reason, error: r.error })),
  };
}

/** The detail view adds what the list deliberately leaves out. */
function toDetail(l: ISyncLog) {
  return { ...toSummary(l), request_body: l.request_body, results: l.results ?? [] };
}

export const syncLogsService = {
  async list(query: {
    failed_only?: boolean;
    status_code?: number;
    client_id?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const filter: FilterQuery<ISyncLog> = {};
    if (query.failed_only) filter.failed = { $gt: 0 };
    if (query.status_code) filter.status_code = query.status_code;
    // Matches the item rows, so one queued write can be followed across its retries.
    if (query.client_id) filter["results.client_id"] = query.client_id;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const [items, total] = await Promise.all([
      SyncLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        // request_body is the big field and nobody reads it from a list.
        .select("-request_body")
        .lean<ISyncLog[]>(),
      SyncLog.countDocuments(filter),
    ]);

    return paginated(items.map(toSummary), total, page, pageSize);
  },

  async get(id: string) {
    return toDetail(await findOr404(SyncLog, id, "sync log"));
  },
};
