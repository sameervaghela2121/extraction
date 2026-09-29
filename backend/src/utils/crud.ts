import { Types, type Model, type PipelineStage } from "mongoose";
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

/** A sort for a paged list: field -> direction, in priority order. */
export type SortSpec = Record<string, 1 | -1>;

/** `spec` as given for "asc", every direction flipped for "desc". */
export function directed(spec: SortSpec, order: "asc" | "desc" = "asc"): SortSpec {
  if (order === "asc") return spec;
  return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v === 1 ? -1 : 1])) as SortSpec;
}

/**
 * Case-insensitive, and "A-2" before "A-10" — how people read codes and names, not
 * Mongo's default byte order (where "Zebra" sorts before "apple").
 */
const LIST_COLLATION = { locale: "en", strength: 2, numericOrdering: true };

/** A number no real sort_order reaches, so an unnumbered row sorts after numbered ones. */
const UNNUMBERED = Number.MAX_SAFE_INTEGER;

/**
 * The $sort stages for `sort`, with a missing sort_order sorting last rather than first
 * (Mongo's default for a missing field) and _id as the final tie-breaker, so two rows that
 * compare equal can't swap places between one page and the next.
 */
function sortStages(sort: SortSpec): PipelineStage[] {
  const stages: PipelineStage[] = [];
  const spec: Record<string, 1 | -1> = {};
  for (const [field, dir] of Object.entries(sort)) {
    if (field === "sort_order") {
      stages.push({ $addFields: { _sort_order: { $ifNull: ["$sort_order", UNNUMBERED] } } });
      spec._sort_order = dir;
    } else {
      spec[field] = dir;
    }
  }
  if (!("_id" in spec)) spec._id = 1;
  stages.push({ $sort: spec });
  return stages;
}

/**
 * One page of `stages`' output, sorted, plus the total it was cut from — in a single round
 * trip ($facet) rather than a find and a separate count.
 *
 * `stages` comes first, so a caller can reshape documents before filtering (the papers list
 * unwinds vendors into one row per paper). `project` trims each returned row, which a
 * pipeline needs explicitly: `select: false` on a schema field does not apply to aggregate.
 */
export async function pagedAggregate<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any collection's model
  model: Model<any>,
  stages: PipelineStage[],
  opts: { sort: SortSpec; page: number; pageSize: number; project?: Record<string, 0 | 1> },
): Promise<{ items: T[]; total: number }> {
  const pageStages: PipelineStage.FacetPipelineStage[] = [
    { $skip: (opts.page - 1) * opts.pageSize },
    { $limit: opts.pageSize },
  ];
  if (opts.project) pageStages.push({ $project: opts.project });
  const [result] = await model
    .aggregate<{ items: T[]; total: Array<{ n: number }> }>([
      ...stages,
      ...sortStages(opts.sort),
      { $facet: { items: pageStages, total: [{ $count: "n" }] } },
    ])
    .collation(LIST_COLLATION);
  return { items: result?.items ?? [], total: result?.total[0]?.n ?? 0 };
}

/**
 * Rewrite `sort_order` for a picker from a drag-and-drop's finished order.
 *
 * Without `page`, `ids` is every row's id in its new top-to-bottom order — the original
 * contract. With `page`, the admin panel drags within one page of a paged list, so `ids`
 * is only that page, starting at `page.offset` in the full order. The full order is read
 * with the same sort the list uses, the page's slice is replaced with the new order, and
 * the whole sequence is renumbered 1..N — so rows on other pages keep their place, and the
 * numbering stays contiguous for the next page-level drag. A page whose rows are not the
 * ones currently at that position (someone reordered or added a row meanwhile) is refused
 * rather than scrambling the order.
 */
export async function reorderDocs<T extends { sort_order?: number }>(
  model: Model<T>,
  label: string,
  ids: string[],
  page?: { offset: number; sort: SortSpec },
): Promise<void> {
  if (ids.some((id) => !Types.ObjectId.isValid(id))) {
    throw ApiError.badRequest(`One or more ${label} ids are invalid`);
  }
  if (new Set(ids).size !== ids.length) {
    throw ApiError.badRequest(`The same ${label} appears twice in the new order`);
  }

  let sequence = ids;
  if (page) {
    const all = await model
      .aggregate<{ _id: Types.ObjectId }>([...sortStages(page.sort), { $project: { _id: 1 } }])
      .collation(LIST_COLLATION);
    const current = all.map((d) => d._id.toString());
    const slice = current.slice(page.offset, page.offset + ids.length);
    const sameRows = slice.length === ids.length && slice.every((id) => ids.includes(id));
    if (!sameRows) {
      throw ApiError.conflict(`The ${label} list changed since it was loaded — reload and try again`);
    }
    sequence = [...current.slice(0, page.offset), ...ids, ...current.slice(page.offset + ids.length)];
  } else {
    const count = await model.countDocuments({ _id: { $in: ids } } as never);
    if (count !== ids.length) {
      throw ApiError.badRequest(`One or more ${label} ids were not found`);
    }
  }

  await model.bulkWrite(
    sequence.map((id, index) => ({
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
