import { Types, type Model } from "mongoose";
import { ApiError } from "./ApiError";

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
