import { type FilterQuery } from "mongoose";
import {
  RawMaterial,
  type IRawMaterial,
  type RawMaterialStatus,
} from "../models/RawMaterial.model";
import { escapeRegex, findOr404, ensureCodeFree, applyUpdates } from "../utils/crud";

type RawMaterialInput = {
  material_code: string;
  name: string;
  category?: string;
  gsm?: number;
  width_mm?: number;
  unit: string;
  reorder_level?: number;
  sort_order?: number;
  status?: RawMaterialStatus;
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

export const rawMaterialsService = {
  // No pagination, same reasoning as vendors: master data, read whole into pickers.
  async list(query: { q?: string; status?: RawMaterialStatus; category?: string }) {
    const filter: FilterQuery<IRawMaterial> = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ name: rx }, { material_code: rx }];
    }
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

  async get(id: string) {
    return toResponse(await findOr404(RawMaterial, id, "material"));
  },

  async create(input: RawMaterialInput) {
    const code = input.material_code.toUpperCase();
    await ensureCodeFree(RawMaterial, "material_code", code, CODE_TAKEN);
    const material = await RawMaterial.create({ ...input, material_code: code });
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
};
