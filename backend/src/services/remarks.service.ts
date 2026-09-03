import { type FilterQuery } from "mongoose";
import { Remark, type IRemark, type RemarkStatus } from "../models/Remark.model";
import { escapeRegex, findOr404, ensureCodeFree, applyUpdates } from "../utils/crud";

type RemarkInput = {
  remark_code: string;
  label: string;
  sort_order?: number;
  status?: RemarkStatus;
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

export const remarksService = {
  // No pagination, same reasoning as the other masters: a picker reads the whole list.
  async list(query: { q?: string; status?: RemarkStatus }) {
    const filter: FilterQuery<IRemark> = {};
    if (query.status) filter.status = query.status;
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
    return toResponse(await Remark.create({ ...input, remark_code: code }));
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
};
