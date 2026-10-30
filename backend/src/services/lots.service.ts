import { Types, type FilterQuery, type HydratedDocument } from "mongoose";
import { Lot, type ILot } from "../models/Lot.model";
import { nextSequence } from "../models/Counter.model";
import { ApiError } from "../utils/ApiError";
import { escapeRegex, paginated } from "../utils/crud";
import { findReplay, isReplayCollision, resolveReplay } from "../utils/idempotency";
import type { CreateLotInput } from "../validators/lots.validators";
import { mediaService } from "./media.service";

const LOT_SEQUENCE = "lot";

/** The list carries no photo URL — signing one per row is a network call each; the detail
 *  and the create response, which show the photo, do. */
async function toResponse(lot: ILot | HydratedDocument<ILot>, withPhotoUrl: boolean) {
  return {
    id: lot._id.toString(),
    lot_number: lot.lot_number,
    challan_no: lot.challan_no,
    challan_photo_path: lot.challan_photo_path ?? null,
    challan_photo_url: withPhotoUrl ? await mediaService.signedReadUrlOrNull(lot.challan_photo_path) : null,
    // Echoed so a device pulling a delta can match the lot to the one it queued.
    client_id: lot.client_id,
    created_by: lot.created_by?.toString(),
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
  };
}

export const lotsService = {
  async create(input: CreateLotInput, actingUserId: string) {
    // A retried sync gets its lot back — and must, before a number is spent on it.
    const replayed = await findReplay(Lot, input.client_id);
    if (replayed) return toResponse(replayed, true);

    const seq = await nextSequence(LOT_SEQUENCE);
    let lot: HydratedDocument<ILot>;
    try {
      lot = await Lot.create({
        lot_number: `Lot-${seq}`,
        lot_seq: seq,
        challan_no: input.challan_no,
        challan_photo_path: input.challan_photo_path,
        client_id: input.client_id,
        created_by: new Types.ObjectId(actingUserId),
      });
    } catch (err) {
      // Two flushes of the same queued lot in flight at once: one wins the client_id, the
      // other returns it. The loser's number stays unused — a gap, never a duplicate.
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
      filter.$or = [{ lot_number: rx }, { challan_no: rx }];
    }
    const [items, total] = await Promise.all([
      Lot.find(filter)
        // Delta pull walks forward; otherwise newest lot first.
        .sort(query.updated_after ? { updatedAt: 1, _id: 1 } : { lot_seq: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<ILot[]>(),
      Lot.countDocuments(filter),
    ]);
    return paginated(await Promise.all(items.map((l) => toResponse(l, false))), total, page, pageSize);
  },

  /** For a roll naming a lot: it must exist. Returns the lot for the roll response. */
  async requireLot(id: string) {
    const lot = await Lot.findById(id).select("lot_number challan_no").lean();
    if (!lot) throw ApiError.badRequest("That lot no longer exists — pick another");
    return lot;
  },
};
