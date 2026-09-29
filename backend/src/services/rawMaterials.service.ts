import { type FilterQuery } from "mongoose";
import { RawMaterial, type IRawMaterial } from "../models/RawMaterial.model";
import type { MasterStatus } from "../models/masterStatus";
import type { z } from "zod";
import type { searchRawMaterialsSchema } from "../validators/rawMaterials.validators";
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

type RawMaterialInput = {
  material_code: string;
  name: string;
  category?: string;
  gsm?: number;
  width_mm?: number;
  unit: string;
  reorder_level?: number;
  sort_order?: number;
  status?: MasterStatus;
};

const PATCHABLE = [
  "name",
  "category",
  "gsm",
  "width_mm",
  "unit",
  "reorder_level",
  "sort_order",
  "status",
] as const;
const CODE_TAKEN = "A material with this code already exists";

function toResponse(m: IRawMaterial) {
  return {
    id: m._id.toString(),
    material_code: m.material_code,
    name: m.name,
    category: m.category,
    gsm: m.gsm,
    width_mm: m.width_mm,
    unit: m.unit,
    reorder_level: m.reorder_level,
    sort_order: m.sort_order,
    status: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/** Shared by the GET list (the app's picker) and the admin panel's paged search. */
function filterOf(query: { q?: string; status?: MasterStatus; category?: string }): FilterQuery<IRawMaterial> {
  const filter: FilterQuery<IRawMaterial> = {};
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ name: rx }, { material_code: rx }];
  }
  return filter;
}

/** What each sortable column sorts by. sort_order is the default, unnumbered materials last
 *  and name breaking ties — the same order the GET list builds by hand. */
const SORTS: Record<NonNullable<z.infer<typeof searchRawMaterialsSchema>["sort"]>, SortSpec> = {
  sort_order: { sort_order: 1, name: 1 },
  material_code: { material_code: 1 },
  name: { name: 1 },
};

export const rawMaterialsService = {
  // No pagination, same reasoning as vendors: master data, read whole into pickers.
  async list(query: { q?: string; status?: MasterStatus; category?: string }) {
    const filter = filterOf(query);
    const materials = await RawMaterial.find(filter).lean<IRawMaterial[]>();
    /**
     * sort_order first, name as the tiebreaker — the same rule the locations master uses.
     *
     * Sorted here rather than in Mongo because Mongo puts a MISSING field before any
     * number: with no material numbered yet, the first person to set sort_order would
     * watch that material drop to the bottom of the list instead of rising to the top.
     * Unnumbered means "no opinion", so those go last. The list is unpaginated and a few
     * hundred rows, so this costs nothing.
     */
    const LAST = Number.MAX_SAFE_INTEGER;
    return materials
      .sort(
        (a, b) =>
          (a.sort_order ?? LAST) - (b.sort_order ?? LAST) ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      )
      .map(toResponse);
  },

  /** One page for the admin panel: filtered, sorted and paged in the database. */
  async search(input: z.infer<typeof searchRawMaterialsSchema>) {
    const { items, total } = await pagedAggregate<IRawMaterial>(RawMaterial, [{ $match: filterOf(input) }], {
      sort: directed(SORTS[input.sort ?? "sort_order"], input.order),
      page: input.page,
      pageSize: input.pageSize,
    });
    return paginated(items.map(toResponse), total, input.page, input.pageSize);
  },

  async get(id: string) {
    return toResponse(await findOr404(RawMaterial, id, "material"));
  },

  async create(input: RawMaterialInput) {
    const code = input.material_code.toUpperCase();
    await ensureCodeFree(RawMaterial, "material_code", code, CODE_TAKEN);
    const sort_order = input.sort_order ?? (await nextSortOrder(RawMaterial));
    const material = await RawMaterial.create({ ...input, material_code: code, sort_order });
    return toResponse(material);
  },

  async update(id: string, updates: Partial<RawMaterialInput>) {
    const material = await findOr404(RawMaterial, id, "material");
    if (updates.material_code) {
      const code = updates.material_code.toUpperCase();
      if (code !== material.material_code) {
        await ensureCodeFree(RawMaterial, "material_code", code, CODE_TAKEN);
        material.material_code = code;
      }
    }
    applyUpdates(material, updates, PATCHABLE);
    await material.save();
    return toResponse(material);
  },

  // Soft delete: stock and receipts keep pointing at the material, so the row stays.
  async remove(id: string) {
    const material = await findOr404(RawMaterial, id, "material");
    material.status = "inactive";
    await material.save();
    return { id: material._id.toString(), status: material.status };
  },

  async reorder(ids: string[], offset?: number) {
    await reorderDocs(RawMaterial, "material", ids, offset === undefined ? undefined : { offset, sort: SORTS.sort_order });
    return rawMaterialsService.list({});
  },
};
