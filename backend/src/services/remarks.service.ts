import { type FilterQuery } from "mongoose";
import { Remark, type IRemark } from "../models/Remark.model";
import type { MasterStatus } from "../models/masterStatus";
import type { z } from "zod";
import type { searchRemarksSchema } from "../validators/remarks.validators";
import {
  escapeRegex,
  findOr404,
  ensureCodeFree,
  applyUpdates,
  nextSortOrder,
  reorderDocs,
  directed,
  paginated,
  pagedAggregate,
  type SortSpec,
} from "../utils/crud";

type RemarkInput = {
  remark_code: string;
  label: string;
  sort_order?: number;
  status?: MasterStatus;
};

const PATCHABLE = ["label", "sort_order", "status"] as const;
const CODE_TAKEN = "A remark with this code already exists";

function toResponse(r: IRemark) {
  return {
    id: r._id.toString(),
    remark_code: r.remark_code,
    label: r.label,
    sort_order: r.sort_order,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Shared by the GET list (the app's picker) and the admin panel's paged search. */
function filterOf(query: { q?: string; status?: MasterStatus }): FilterQuery<IRemark> {
  const filter: FilterQuery<IRemark> = {};
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ label: rx }, { remark_code: rx }];
  }
  return filter;
}

/** What each sortable column sorts by. sort_order is the default — the common remarks at
 *  the top — with label breaking ties the same way the GET list does. */
const SORTS: Record<NonNullable<z.infer<typeof searchRemarksSchema>["sort"]>, SortSpec> = {
  sort_order: { sort_order: 1, label: 1 },
  remark_code: { remark_code: 1 },
  label: { label: 1 },
};

export const remarksService = {
  // No pagination, same reasoning as the other masters: a picker reads the whole list.
  async list(query: { q?: string; status?: MasterStatus }) {
    const filter = filterOf(query);
    // sort_order first so the common remarks sit at the top of the picker; label breaks
    // ties and covers rows nobody has ordered yet.
    const remarks = await Remark.find(filter).sort({ sort_order: 1, label: 1 }).lean<IRemark[]>();
    return remarks.map(toResponse);
  },

  /** One page for the admin panel: filtered, sorted and paged in the database. */
  async search(input: z.infer<typeof searchRemarksSchema>) {
    const { items, total } = await pagedAggregate<IRemark>(Remark, [{ $match: filterOf(input) }], {
      sort: directed(SORTS[input.sort ?? "sort_order"], input.order),
      page: input.page,
      pageSize: input.pageSize,
    });
    return paginated(items.map(toResponse), total, input.page, input.pageSize);
  },

  async get(id: string) {
    return toResponse(await findOr404(Remark, id, "remark"));
  },

  async create(input: RemarkInput) {
    const code = input.remark_code.toUpperCase();
    await ensureCodeFree(Remark, "remark_code", code, CODE_TAKEN);
    const sort_order = input.sort_order ?? (await nextSortOrder(Remark));
    return toResponse(await Remark.create({ ...input, remark_code: code, sort_order }));
  },

  async update(id: string, updates: Partial<RemarkInput>) {
    const remark = await findOr404(Remark, id, "remark");
    if (updates.remark_code) {
      const code = updates.remark_code.toUpperCase();
      if (code !== remark.remark_code) {
        await ensureCodeFree(Remark, "remark_code", code, CODE_TAKEN);
        remark.remark_code = code;
      }
    }
    applyUpdates(remark, updates, PATCHABLE);
    await remark.save();
    return toResponse(remark);
  },

  // Soft delete, same as the other masters: movements record the remark code they were
  // given, so retiring a remark must not erase what was already noted with it.
  async remove(id: string) {
    const remark = await findOr404(Remark, id, "remark");
    remark.status = "inactive";
    await remark.save();
    return { id: remark._id.toString(), status: remark.status };
  },

  async reorder(ids: string[], offset?: number) {
    await reorderDocs(Remark, "remark", ids, offset === undefined ? undefined : { offset, sort: SORTS.sort_order });
    return remarksService.list({});
  },
};
