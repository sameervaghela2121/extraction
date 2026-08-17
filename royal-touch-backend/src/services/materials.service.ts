import { Material, type IMaterial } from "../models/Material.model";
import { ApiError } from "../utils/ApiError";
import { escapeRegex } from "../utils/escapeRegex";

/** The Select Material list — deliberately thin, it renders as rows with a thumbnail. */
function toListItem(material: IMaterial) {
  return {
    id: material._id.toString(),
    name: material.name,
    sku: material.sku,
    thumbnailUrl: material.thumbnailUrl ?? null,
  };
}

/**
 * The Material Details screen, and the source of the roll form's prefilled values.
 *
 * `batchId` and `location` are deliberately absent, though the API doc lists them here:
 * both are properties of a physical roll, not of a specification. Two rolls of this exact
 * material arrive in different batches and sit on different racks.
 */
function toDetail(material: IMaterial) {
  return {
    ...toListItem(material),
    supplierCode: material.supplierCode,
    designCode: material.designCode ?? null,
    supplierMaterialCode: material.supplierMaterialCode ?? null,
    widthMm: material.widthMm,
    gsm: material.gsm,
    coreMm: material.coreMm ?? null,
    countryOfOrigin: material.countryOfOrigin ?? null,
    // Expected values for a full roll — the form prefills these, staff overwrite with
    // what the scale actually says.
    nominalWeightKg: material.nominalWeightKg ?? null,
    nominalLengthM: material.nominalLengthM ?? null,
  };
}

export const materialsService = {
  /** GET /api/v1/materials?search=&page=&limit= */
  async list(search: string | undefined, page: number, limit: number) {
    const filter: Record<string, unknown> = { isActive: true };
    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      // Design code included because that is what is printed on the roll the operator is
      // holding — "Twinkle" and "083860/004" identify the same material to different people.
      filter.$or = [{ name: pattern }, { sku: pattern }, { designCode: pattern }];
    }

    // Counting alongside the page keeps the Android list from having to guess whether
    // another page exists.
    const [materials, total] = await Promise.all([
      Material.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Material.countDocuments(filter),
    ]);

    return { items: materials.map(toListItem), page, limit, total };
  },

  /** GET /api/v1/materials/:materialId */
  async detail(materialId: string) {
    const material = await Material.findById(materialId);
    if (!material || !material.isActive) {
      throw ApiError.notFound("Material not found");
    }
    return toDetail(material);
  },
};
