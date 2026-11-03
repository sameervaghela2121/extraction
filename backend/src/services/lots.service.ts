import { Types, type FilterQuery, type HydratedDocument } from "mongoose";
import { Lot, type ILot } from "../models/Lot.model";
import { ApiError } from "../utils/ApiError";
import { escapeRegex, paginated } from "../utils/crud";
import { findReplay, isReplayCollision, resolveReplay } from "../utils/idempotency";
import type { CreateLotInput } from "../validators/lots.validators";
import { mediaService } from "./media.service";

/** The list carries no photo URL — signing one per row is a network call each; the detail
 *  and the create response, which show the photo, do. */
async function toResponse(lot: ILot | HydratedDocument<ILot>, withPhotoUrl: boolean) {
  return {
    id: lot._id.toString(),
    document_type: lot.document_type,
    document_no: lot.document_no,
    document_photo_path: lot.document_photo_path ?? null,
    document_photo_url: withPhotoUrl ? await mediaService.signedReadUrlOrNull(lot.document_photo_path) : null,
    // Echoed so a device pulling a delta can match the lot to the one it queued.
    client_id: lot.client_id,
    created_by: lot.created_by?.toString(),
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
  };
}

export const lotsService = {
  async create(input: CreateLotInput, actingUserId: string) {
    // A retried sync gets its lot back rather than a second copy.
    const replayed = await findReplay(Lot, input.client_id);
    if (replayed) return toResponse(replayed, true);

    let lot: HydratedDocument<ILot>;
    try {
      lot = await Lot.create({
        document_type: input.document_type,
        document_no: input.document_no,
        document_photo_path: input.document_photo_path,
        client_id: input.client_id,
        created_by: new Types.ObjectId(actingUserId),
      });
    } catch (err) {
      // Two flushes of the same queued lot in flight at once: one wins the client_id, the
      // other returns it.
      if (!isReplayCollision(err)) throw err;
      return toResponse(await resolveReplay(Lot, input.client_id!, err), true);
    }
    return toResponse(lot, true);
  },

  async get(id: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid lot id");
    const lot = await Lot.findById(id);
    if (!lot) throw ApiError.notFound("Lot not found");
    return toResponse(lot, true);
  },

  async list(query: { q?: string; updated_after?: Date; after_id?: string; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const filter: FilterQuery<ILot> = {};
    if (query.updated_after) {
      const after = query.updated_after;
      filter.$and = [
        query.after_id
          ? { $or: [{ updatedAt: { $gt: after } }, { updatedAt: after, _id: { $gt: new Types.ObjectId(query.after_id) } }] }
          : { updatedAt: { $gt: after } },
      ];
    }
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.document_no = rx;
    }
    const [items, total] = await Promise.all([
      Lot.find(filter)
        // Delta pull walks forward; otherwise newest lot first (an _id grows with time).
        .sort(query.updated_after ? { updatedAt: 1, _id: 1 } : { _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<ILot[]>(),
      Lot.countDocuments(filter),
    ]);
    return paginated(await Promise.all(items.map((l) => toResponse(l, false))), total, page, pageSize);
  },

  /** For a roll naming a lot: it must exist. Returns the lot for the roll response. */
  async requireLot(id: string) {
    const lot = await Lot.findById(id).select("document_type document_no").lean();
    if (!lot) throw ApiError.badRequest("That lot no longer exists — pick another");
    return lot;
  },
};
