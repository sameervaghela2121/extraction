import { type FilterQuery } from "mongoose";
import { Remark, type IRemark } from "../models/Remark.model";
import {
  escapeRegex,
  findOr404,
  ensureCodeFree,
  applyUpdates,
  nextSortOrder,
  reorderDocs,
} from "../utils/crud";

type RemarkInput = {
  remark_code: string;
  label: string;
  sort_order?: number;
  is_active?: boolean;
};

const PATCHABLE = ["label", "sort_order", "is_active"] as const;
const CODE_TAKEN = "A remark with this code already exists";

function toResponse(r: IRemark) {
  return {
    id: r._id.toString(),
    remark_code: r.remark_code,
    label: r.label,
    sort_order: r.sort_order,
    is_active: r.is_active,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const remarksService = {
  // No pagination, same reasoning as the other masters: a picker reads the whole list.
  async list(query: { q?: string; is_active?: boolean }) {
    const filter: FilterQuery<IRemark> = {};
    if (query.is_active !== undefined) filter.is_active = query.is_active;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ label: rx }, { remark_code: rx }];
    }
    // sort_order first so the common remarks sit at the top of the picker; label breaks
    // ties and covers rows nobody has ordered yet.
    const remarks = await Remark.find(filter).sort({ sort_order: 1, label: 1 }).lean<IRemark[]>();
    return remarks.map(toResponse);
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
    remark.is_active = false;
    await remark.save();
    return { id: remark._id.toString(), is_active: remark.is_active };
  },

  async reorder(ids: string[]) {
    await reorderDocs(Remark, "remark", ids);
    return remarksService.list({});
  },
};
