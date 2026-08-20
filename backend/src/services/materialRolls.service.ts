import { Types, type FilterQuery } from "mongoose";
import { MaterialRoll, type IMaterialRoll, type RollStatus } from "../models/MaterialRoll.model";
import { StockTransaction } from "../models/StockTransaction.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { Vendor } from "../models/Vendor.model";
import { ApiError } from "../utils/ApiError";
import { escapeRegex, ensureCodeFree, applyUpdates, paginated } from "../utils/crud";
import { refreshSummaries, refreshSummary } from "./stockSummary.service";
import { mediaService } from "./media.service";

type RollInput = {
  roll_number: string;
  material_id: string;
  vendor_id?: string;
  batch_no?: string;
  initial_weight?: number;
  remaining_weight?: number;
  quantity?: number;
  unit?: string;
  gsm?: number;
  width_mm?: number;
  location?: string;
  received_date: string;
  status?: RollStatus;
  tag_photo_path?: string;
  stitched_barcode_photo_path?: string;
  side1_photo_path?: string;
  side2_photo_path?: string;
};

/** The four photo slots, in the order the registration flow captures them. */
const PHOTO_FIELDS = [
  "tag_photo_path",
  "stitched_barcode_photo_path",
  "side1_photo_path",
  "side2_photo_path",
] as const;

// remaining_weight and status are deliberately absent: both only move through stock
// movements, which write a ledger row for the change. See updateRollSchema.
const PATCHABLE = [
  "batch_no",
  "initial_weight",
  "quantity",
  "unit",
  "gsm",
  "width_mm",
  "location",
  ...PHOTO_FIELDS,
] as const;
const ROLL_TAKEN = "A roll with this number already exists";

/** What .populate(path, "name") leaves behind in place of the ObjectId. */
type NamedRef = { _id: Types.ObjectId; name: string };

// Only the two ref paths, and only their name — a roll list shouldn't drag whole
// vendor and material documents across the wire.
const REF_POPULATE = [
  { path: "material_id", select: "name" },
  { path: "vendor_id", select: "name" },
];

function refResponse(ref?: Types.ObjectId | NamedRef) {
  if (!ref) return undefined;
  // `id`, not `_id` — every other response in this codebase exposes it that way.
  // Unpopulated (a ref whose target was deleted) still returns the id, never null.
  if (ref instanceof Types.ObjectId) return { id: ref.toString(), name: null };
  return { id: ref._id.toString(), name: ref.name };
}

type PopulatedRoll = Omit<IMaterialRoll, "material_id" | "vendor_id"> & {
  material_id: Types.ObjectId | NamedRef;
  vendor_id?: Types.ObjectId | NamedRef;
};

async function toResponse(r: PopulatedRoll) {
  // Signing is local crypto, no network call, so four per roll is cheap.
  const [tag, stitched, side1, side2] = await Promise.all(
    PHOTO_FIELDS.map((field) => mediaService.signedReadUrlOrNull(r[field])),
  );

  return {
    id: r._id.toString(),
    roll_number: r.roll_number,
    material_id: refResponse(r.material_id),
    vendor_id: refResponse(r.vendor_id),
    batch_no: r.batch_no,
    initial_weight: r.initial_weight,
    remaining_weight: r.remaining_weight,
    quantity: r.quantity,
    unit: r.unit,
    gsm: r.gsm,
    width_mm: r.width_mm,
    location: r.location,
    received_date: r.received_date,
    status: r.status,
    // Paths are what the client submits back; URLs are what it renders. Both are sent so
    // an edit screen can round-trip the photos without re-uploading them.
    tag_photo_path: r.tag_photo_path,
    stitched_barcode_photo_path: r.stitched_barcode_photo_path,
    side1_photo_path: r.side1_photo_path,
    side2_photo_path: r.side2_photo_path,
    tag_photo_url: tag,
    stitched_barcode_photo_url: stitched,
    side1_photo_url: side1,
    side2_photo_url: side2,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Mongo won't enforce these references, so check them at the boundary — a roll pointing
 * at a material that doesn't exist is invisible until a report breaks.
 *
 * Retired master records are refused as well: an inactive material or vendor is one
 * somebody deliberately took out of circulation, so new stock must not be booked
 * against it. Only checked for references actually being set, so editing an unrelated
 * field on an old roll whose vendor has since retired still works.
 */
/**
 * Find a roll by its Mongo id or by the number printed on it.
 *
 * A phone scans a barcode and has "2050280005040104", never an ObjectId — making the
 * client fetch a list just to translate one into the other would be a wasted round trip
 * on every scan. The id is tried first because it is unambiguous; anything that is not a
 * valid ObjectId can only be a roll number.
 */
async function findRoll(idOrNumber: string) {
  if (Types.ObjectId.isValid(idOrNumber)) {
    const byId = await MaterialRoll.findById(idOrNumber);
    if (byId) return byId;
  }
  const byNumber = await MaterialRoll.findOne({ roll_number: idOrNumber.toUpperCase() });
  if (!byNumber) throw ApiError.notFound("Roll not found");
  return byNumber;
}

async function assertRefsUsable(materialId?: string, vendorId?: string) {
  if (materialId) {
    const material = await RawMaterial.findById(materialId).select("status name").lean();
    if (!material) throw ApiError.badRequest("That material no longer exists — pick another");
    if (material.status !== "active") {
      throw ApiError.badRequest(`${material.name} is inactive — reactivate it before booking stock against it`);
    }
  }
  if (vendorId) {
    const vendor = await Vendor.findById(vendorId).select("status name").lean();
    if (!vendor) throw ApiError.badRequest("That vendor no longer exists — pick another");
    if (vendor.status !== "active") {
      throw ApiError.badRequest(`${vendor.name} is inactive — pick a different vendor`);
    }
  }
}

export const materialRollsService = {
  // Paginated, unlike the masters: rolls grow without bound.
  async list(query: {
    q?: string;
    material_id?: string;
    vendor_id?: string;
    status?: RollStatus;
    location?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const filter: FilterQuery<IMaterialRoll> = {};
    if (query.status) filter.status = query.status;
    if (query.material_id) filter.material_id = new Types.ObjectId(query.material_id);
    if (query.vendor_id) filter.vendor_id = new Types.ObjectId(query.vendor_id);
    if (query.location) filter.location = query.location;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ roll_number: rx }, { batch_no: rx }];
    }

    const [items, total] = await Promise.all([
      MaterialRoll.find(filter)
        .sort({ received_date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate(REF_POPULATE)
        .lean<PopulatedRoll[]>(),
      MaterialRoll.countDocuments(filter),
    ]);

    return paginated(await Promise.all(items.map(toResponse)), total, page, pageSize);
  },

  async get(id: string) {
    const roll = await findRoll(id);
    await roll.populate(REF_POPULATE);
    return toResponse(roll as unknown as PopulatedRoll);
  },

  /** Receiving a roll is itself a stock movement, so it writes one. Rolls, transactions
   *  and the summary then agree without anyone having to remember a second call. */
  async create(input: RollInput, actingUserId: string) {
    const rollNumber = input.roll_number.toUpperCase();
    await ensureCodeFree(MaterialRoll, "roll_number", rollNumber, ROLL_TAKEN);
    await assertRefsUsable(input.material_id, input.vendor_id);

    // A newly received roll is full unless the caller says otherwise. A roll registered
    // before it was weighed simply has no weight yet.
    const remaining = input.remaining_weight ?? input.initial_weight;
    if (
      remaining !== undefined &&
      input.initial_weight !== undefined &&
      remaining > input.initial_weight
    ) {
      throw ApiError.badRequest(
        `A roll cannot hold more than the ${input.initial_weight} ${input.unit ?? "kg"} it arrived with`,
      );
    }

    const roll = await MaterialRoll.create({
      ...input,
      roll_number: rollNumber,
      remaining_weight: remaining,
    });
    // A new roll changes what's on hand, so the material's cached totals must follow it.
    const summary = await refreshSummary(roll.material_id);

    await StockTransaction.create({
      transaction_type: "IN",
      // Dated when the roll arrived, not when it was keyed in — a roll entered a week
      // late must still land in the right place in the history.
      transaction_date: roll.received_date,
      material_id: roll.material_id,
      roll_id: roll._id,
      vendor_id: roll.vendor_id,
      weight: roll.remaining_weight ?? 0,
      material_weight_after: summary.total_weight,
      roll_weight_after: roll.remaining_weight,
      remarks: `Roll ${roll.roll_number} received`,
      created_by: new Types.ObjectId(actingUserId),
    });

    await roll.populate(REF_POPULATE);
    return toResponse(roll as unknown as PopulatedRoll);
  },

  async update(id: string, updates: Partial<RollInput>) {
    const roll = await findRoll(id);
    // Remembered before the update: if the roll is re-pointed at another material, both
    // the old and the new material's totals change.
    const previousMaterialId = roll.material_id;
    if (updates.roll_number) {
      const rollNumber = updates.roll_number.toUpperCase();
      if (rollNumber !== roll.roll_number) {
        await ensureCodeFree(MaterialRoll, "roll_number", rollNumber, ROLL_TAKEN);
        roll.roll_number = rollNumber;
      }
    }
    // Only the refs being pointed somewhere new are checked — re-saving a roll whose
    // material was retired after it arrived must not be blocked by that retirement.
    const changedMaterial =
      updates.material_id && updates.material_id !== roll.material_id.toString()
        ? updates.material_id
        : undefined;
    const changedVendor =
      updates.vendor_id && updates.vendor_id !== roll.vendor_id?.toString()
        ? updates.vendor_id
        : undefined;
    await assertRefsUsable(changedMaterial, changedVendor);

    if (updates.material_id !== undefined) roll.material_id = new Types.ObjectId(updates.material_id);
    if (updates.vendor_id !== undefined) roll.vendor_id = new Types.ObjectId(updates.vendor_id);
    applyUpdates(roll, updates, PATCHABLE);
    // Not in PATCHABLE: these arrive as strings and need converting first.
    if (updates.received_date !== undefined) roll.received_date = new Date(updates.received_date);

    if (
      roll.remaining_weight !== undefined &&
      roll.initial_weight !== undefined &&
      roll.remaining_weight > roll.initial_weight
    ) {
      throw ApiError.badRequest(
        `A roll cannot hold more than the ${roll.initial_weight} ${roll.unit} it arrived with`,
      );
    }
    await roll.save();
    await refreshSummaries([previousMaterialId, roll.material_id]);
    await roll.populate(REF_POPULATE);
    return toResponse(roll as unknown as PopulatedRoll);
  },

  // Hard delete, unlike the masters: this is for a mis-scanned roll that never
  // existed. Once any of it has been issued, the roll is history and must stay.
  async remove(id: string) {
    const roll = await findRoll(id);
    if (roll.status !== "IN_STOCK" || roll.remaining_weight !== roll.initial_weight) {
      throw ApiError.conflict("This roll has already been used, so it can no longer be deleted");
    }
    await roll.deleteOne();
    // The roll never really existed (this only runs while it's untouched), so its
    // receipt row goes with it rather than pointing at nothing.
    await StockTransaction.deleteMany({ roll_id: roll._id });
    await refreshSummaries([roll.material_id]);
    return { id, deleted: true };
  },
};
