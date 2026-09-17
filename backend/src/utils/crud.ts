import { Types, type Model } from "mongoose";
import { ApiError } from "./ApiError";

/** Where a newly created row lands in a `sort_order`-driven picker: after everything that
 *  already has a number. Queried fresh each time rather than cached — these masters are
 *  small (a handful to a few hundred rows), so a max-scan is cheap, and caching a "next"
 *  counter would drift the moment two people create a row close together. */
export async function nextSortOrder<T extends { sort_order?: number }>(
  model: Model<T>,
): Promise<number> {
  const highest = await model.findOne({}).sort({ sort_order: -1 }).select("sort_order").lean();
  return ((highest as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
}

/**
 * Rewrite `sort_order` for a whole picker at once, from a drag-and-drop's finished order.
 *
 * The caller sends every row's id in its new top-to-bottom order (not just the ones that
 * moved) — simplest possible contract, and it sidesteps the off-by-one bugs a "shift only
 * the affected range" endpoint invites. Ids are matched against the collection first so a
 * stale or foreign id fails the whole request with a clear 400 rather than silently
 * numbering a partial list.
 */
export async function reorderDocs<T extends { sort_order?: number }>(
  model: Model<T>,
  label: string,
  ids: string[],
): Promise<void> {
  if (ids.some((id) => !Types.ObjectId.isValid(id))) {
    throw ApiError.badRequest(`One or more ${label} ids are invalid`);
  }
  const count = await model.countDocuments({ _id: { $in: ids } } as never);
  if (count !== ids.length) {
    throw ApiError.badRequest(`One or more ${label} ids were not found`);
  }
  await model.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sort_order: index + 1 } } },
    })) as never,
  );
}

/** Make user input safe to drop into a RegExp — an unescaped `(a+)+` would otherwise
 *  force a pathological scan. Same treatment as grn.service's search filter. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Load by id or throw. `label` names the thing in the error ("vendor", "roll"). */
export async function findOr404<T>(model: Model<T>, id: string, label: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest(`Invalid ${label} id`);
  const doc = await model.findById(id);
  if (!doc) throw ApiError.notFound(`${label[0].toUpperCase()}${label.slice(1)} not found`);
  return doc;
}

/** Guard a human-facing unique code before insert/rename. The unique index is what
 *  actually prevents the race; this exists to turn it into a clean 409. */
export async function ensureCodeFree<T>(
  model: Model<T>,
  field: string,
  code: string,
  message: string,
): Promise<void> {
  if (await model.exists({ [field]: code } as never)) {
    throw ApiError.conflict(message);
  }
}

/** Copy the listed fields off a PATCH body onto a document, skipping only the ones the
 *  caller omitted. `!== undefined` rather than truthiness: 0 and "" are real values. */
export function applyUpdates<T extends object, K extends keyof T>(
  doc: T,
  updates: Partial<Record<K, T[K]>>,
  fields: readonly K[],
): void {
  for (const field of fields) {
    const value = updates[field];
    if (value !== undefined) doc[field] = value;
  }
}

/** Page/pageSize normalisation plus the envelope every list endpoint returns. */
export function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    total,
    page,
    pageSize,
    // Max(1) so an empty list reads as "page 1 of 1", matching grn.service.
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
