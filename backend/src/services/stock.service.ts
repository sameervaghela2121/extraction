import { Types, type FilterQuery, type HydratedDocument } from "mongoose";
import {
  StockTransaction,
  type IStockTransaction,
  type TransactionType,
} from "../models/StockTransaction.model";
import { StockSummary, type IStockSummary } from "../models/StockSummary.model";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { Vendor } from "../models/Vendor.model";
import { ApiError } from "../utils/ApiError";
import { paginated } from "../utils/crud";
import { findReplay, isReplayCollision, resolveReplay } from "../utils/idempotency";
import { refreshSummary } from "./stockSummary.service";
import { mediaService } from "./media.service";

type MovementInput = {
  transaction_type: TransactionType;
  transaction_date?: string;
  material_id: string;
  roll_id?: string;
  vendor_id?: string;
  /** IN only: weight being added back. */
  weight?: number;
  /** ADJUSTMENT only: the corrected weight from a physical count. */
  new_weight?: number;
  /** RETURN only: what the roll weighs coming back, straight off the scale. This becomes
   *  the roll's weight; how much was used is worked out from it. */
  returned_weight?: number;
  /** OUT only: where the roll is going. An OUT needs nothing else — no quantity, since
   *  the whole roll leaves and consumption is declared on the return. */
  location?: string;
  issued_to?: string;
  remarks?: string;
  /** OUT/RETURN: photos of the roll captured at the movement, already uploaded via
   *  POST /media/upload. Object paths, not URLs. */
  photo_paths?: string[];
  /** Offline flush: the device's id for this queued movement. See recordMovement. */
  client_id?: string;
};

/** Each ref carries its own natural label, not all of them a "name". */
type NamedRef = { _id: Types.ObjectId; name?: string; roll_number?: string };

const REF_POPULATE = [
  { path: "material_id", select: "name" },
  { path: "vendor_id", select: "name" },
  { path: "roll_id", select: "roll_number" },
  { path: "created_by", select: "name" },
];

function refResponse(ref: Types.ObjectId | NamedRef | undefined, labelKey: "name" | "roll_number") {
  if (!ref) return undefined;
  // `id`, not `_id` — matches how every other response in this codebase exposes ids.
  // Unpopulated (deleted target) still returns the id rather than vanishing.
  if (ref instanceof Types.ObjectId) return { id: ref.toString(), [labelKey]: null };
  return { id: ref._id.toString(), [labelKey]: ref[labelKey] ?? null };
}

type PopulatedTransaction = Omit<
  IStockTransaction,
  "material_id" | "roll_id" | "vendor_id" | "created_by"
> & {
  material_id: Types.ObjectId | NamedRef;
  roll_id?: Types.ObjectId | NamedRef;
  vendor_id?: Types.ObjectId | NamedRef;
  created_by: Types.ObjectId | NamedRef;
};

/**
 * One line of plain English per movement.
 *
 * A RETURN carries two weights — what the line used and what came back on the roll — and
 * showing either one alone reads as wrong to the person who typed the other. Rather than
 * leaving every client to work that out, the row says it.
 */
function describe(t: PopulatedTransaction, unit = "kg"): string {
  const to = t.to_location ? ` to ${t.to_location}` : "";
  switch (t.transaction_type) {
    case "IN":
      return `Received ${t.weight} ${unit}`;
    case "OUT":
      return `Issued out ${t.weight} ${unit}${to}`;
    case "RETURN":
      return `Returned ${t.weight} ${unit}${to} · ${t.used_weight ?? 0} ${unit} used`;
    default:
      return `Corrected by ${t.weight} ${unit}`;
  }
}

async function toResponse(t: PopulatedTransaction) {
  // Signing is local crypto, no network call, so doing it per row is cheap.
  const photoPaths = t.photo_paths ?? [];
  const photoUrls = await Promise.all(photoPaths.map((p) => mediaService.signedReadUrl(p)));

  return {
    id: t._id.toString(),
    transaction_type: t.transaction_type,
    transaction_date: t.transaction_date,
    material_id: refResponse(t.material_id, "name"),
    roll_id: refResponse(t.roll_id, "roll_number"),
    vendor_id: refResponse(t.vendor_id, "name"),
    // What moved in or out of the store on this row.
    weight: t.weight,
    // RETURN only: what the line used. Null everywhere else.
    used_weight: t.used_weight ?? null,
    // Ready to render as-is — the app should not have to combine the two numbers.
    description: describe(t),
    from_location: t.from_location,
    to_location: t.to_location,
    // After this movement: what the roll weighs, and what the material has on hand.
    roll_weight_after: t.roll_weight_after ?? null,
    material_weight_after: t.material_weight_after,
    issued_to: t.issued_to,
    remarks: t.remarks,
    // Paths round-trip, URLs render — same split as the roll's registration photos.
    photo_paths: photoPaths,
    photo_urls: photoUrls,
    created_by: refResponse(t.created_by, "name"),
    // Echoed back so a device pulling a delta can match rows against its own outbox and
    // drop the queued copies, rather than guessing from the weights and timestamps.
    client_id: t.client_id,
    createdAt: t.createdAt,
    // The delta-pull checkpoint: the client saves the last one it saw and sends it back
    // as updated_after. Absent from this response until now, which made the pull
    // impossible to resume.
    updatedAt: t.updatedAt,
  };
}

type RollEffect = {
  /** RETURN only: how much was used while the roll was out. */
  used_weight?: number;
  /** The roll's own weight once this movement was applied. */
  roll_weight_after?: number;
  /** Change in on-hand weight for this material. Zero for a movement that relocates a
   *  roll without consuming any of it. */
  delta: number;
  /** What the ledger records as this movement's weight — always a magnitude. */
  weight: number;
  from_location?: string;
  to_location?: string;
};

/**
 * Apply the movement to the roll.
 *
 * The model is: a roll goes OUT whole (nothing consumed yet, it is just somewhere else),
 * and consumption is declared when it comes back. That is why OUT changes no weight and
 * RETURN is the only movement that draws a roll down.
 */
async function applyToRoll(input: MovementInput, rollId: Types.ObjectId): Promise<RollEffect> {
  const roll = await MaterialRoll.findById(rollId);
  if (!roll) throw ApiError.notFound("That roll no longer exists");
  if (roll.material_id.toString() !== input.material_id) {
    throw ApiError.badRequest("This roll belongs to a different material");
  }

  if (input.transaction_type === "OUT") {
    if (roll.status === "ISSUED") {
      throw ApiError.conflict("This roll is already out — record its return first");
    }
    if ((roll.remaining_weight ?? 0) <= 0 && roll.remaining_weight !== undefined) {
      throw ApiError.conflict("This roll is empty, there is nothing to take out");
    }
    const from = roll.location;
    roll.status = "ISSUED";
    // Only when the movement names one: location is required on a roll, so an OUT that
    // does not say where it went must leave the roll where it was rather than blank it.
    if (input.location !== undefined) roll.location = input.location;
    await roll.save();
    // The whole roll leaves the store, so that is what the row records and what drops out
    // of on-hand until it returns.
    return {
      delta: 0,
      // The weight that physically left the store. Zero for a roll not yet weighed.
      weight: roll.remaining_weight ?? 0,
      // Unchanged by an OUT: nothing has been used yet, the roll is just elsewhere.
      roll_weight_after: roll.remaining_weight,
      from_location: from,
      to_location: input.location,
    };
  }

  if (input.transaction_type === "RETURN") {
    if (roll.status !== "ISSUED") {
      throw ApiError.conflict("This roll is not currently out, so it cannot be returned");
    }
    const onRoll = roll.remaining_weight;
    const returned = input.returned_weight ?? 0;
    if (onRoll !== undefined && returned > onRoll) {
      throw ApiError.badRequest(
        `This roll went out with ${onRoll} ${roll.unit} — it cannot come back heavier at ${returned}`,
      );
    }
    // Nobody weighs what was used; they weigh what is left. The difference is the usage.
    const consumed = onRoll !== undefined ? onRoll - returned : 0;
    // Back to exactly where it left from, read off its own OUT row rather than asked for
    // again: the operator returning a roll should not have to remember the rack.
    const lastOut = await StockTransaction.findOne({ roll_id: rollId, transaction_type: "OUT" })
      .sort({ transaction_date: -1, _id: -1 })
      .lean();
    const home = lastOut?.from_location;

    const from = roll.location;
    // The scale reading is the roll's new weight. A roll that went out without ever being
    // weighed gets its first weight here.
    roll.remaining_weight = returned;
    roll.status = returned === 0 ? "CONSUMED" : "IN_STOCK";
    roll.location = home ?? roll.location;
    await roll.save();
    // The store gets back whatever is still on the roll; `consumed` is what the line used.
    const returnedToStore = roll.remaining_weight ?? 0;
    return {
      delta: returnedToStore,
      weight: returnedToStore,
      used_weight: consumed,
      roll_weight_after: roll.remaining_weight,
      from_location: from,
      to_location: home,
    };
  }

  if (input.transaction_type === "IN") {
    const added = input.weight!;
    const current = roll.remaining_weight ?? 0;
    if (roll.weight !== undefined && current + added > roll.weight) {
      throw ApiError.badRequest(
        `This roll only ever held ${roll.weight} ${roll.unit} — cannot add more than that`,
      );
    }
    roll.remaining_weight = current + added;
    if (roll.status === "CONSUMED") roll.status = "IN_STOCK";
    await roll.save();
    return { delta: added, weight: added, roll_weight_after: roll.remaining_weight };
  }

  // ADJUSTMENT: the caller states the corrected weight, we derive the delta.
  const target = input.new_weight!;
  if (roll.weight !== undefined && target > roll.weight) {
    throw ApiError.badRequest(
      `This roll only ever held ${roll.weight} ${roll.unit} — the counted amount cannot be higher`,
    );
  }
  const delta = target - (roll.remaining_weight ?? 0);
  roll.remaining_weight = target;
  if (target === 0) roll.status = "CONSUMED";
  await roll.save();
  return { delta, weight: Math.abs(delta), roll_weight_after: roll.remaining_weight };
}

export const stockService = {
  /** The only write path for stock levels: records the movement, moves the roll, and
   *  refreshes the material's summary. */
  async recordMovement(input: MovementInput, actingUserId: string) {
    // First, above everything — applyToRoll below mutates the roll, and a replay that
    // reaches it is not merely wasteful: a second IN adds the weight again and quietly
    // inflates the stock figure, and a second RETURN is refused as "not currently out",
    // wedging the device's queue behind an item it can never drain. Neither is
    // recoverable from the phone's side, so the replay stops here.
    const replayed = await findReplay(StockTransaction, input.client_id);
    if (replayed) {
      await replayed.populate(REF_POPULATE);
      return toResponse(replayed as unknown as PopulatedTransaction);
    }

    const material = await RawMaterial.findById(input.material_id).select("status name").lean();
    if (!material) throw ApiError.badRequest("That material no longer exists — pick another");

    // Retired masters block stock coming IN, never stock going OUT: a material taken out
    // of circulation still has rolls on the rack, and refusing to issue them would strand
    // that stock with no way to draw it down. Adjustments stay open for the same reason —
    // a stocktake must be recordable whatever the master says.
    const isIncoming = input.transaction_type === "IN";
    if (isIncoming && material.status !== "active") {
      throw ApiError.badRequest(`${material.name} is inactive — reactivate it before adding stock`);
    }

    if (input.vendor_id) {
      const vendor = await Vendor.findById(input.vendor_id).select("status name").lean();
      if (!vendor) throw ApiError.badRequest("That vendor no longer exists — pick another");
      if (isIncoming && vendor.status !== "active") {
        throw ApiError.badRequest(`${vendor.name} is inactive — pick a different vendor`);
      }
    }

    const materialId = new Types.ObjectId(input.material_id);
    const rollId = input.roll_id ? new Types.ObjectId(input.roll_id) : undefined;

    const effect = rollId
      ? await applyToRoll(input, rollId)
      : { delta: 0, weight: input.weight ?? 0 };
    const summary = await refreshSummary(materialId);

    // ponytail: no multi-document transaction — the roll write and this insert aren't
    // atomic together. Needs a replica set + session to close; the summary self-heals
    // on the next movement either way.
    // ponytail: the replay guard above catches sequential retries — a flush that lost its
    // response and sends the same item again later — which is every retry a device that
    // flushes its queue one at a time can produce. It does not cover two flushes of the
    // same client_id genuinely in flight at once: both pass the guard, both run
    // applyToRoll, and only the insert below is rejected, leaving the roll moved twice.
    // Closing that needs the client_id reserved before applyToRoll (insert the row first,
    // fill in the weights after) or a real transaction — worth doing if the mobile client
    // ever flushes in parallel. It must not: see the FIFO requirement in the sync notes.
    let transaction: HydratedDocument<IStockTransaction>;
    try {
      transaction = await StockTransaction.create({
        transaction_type: input.transaction_type,
        transaction_date: input.transaction_date ? new Date(input.transaction_date) : new Date(),
        material_id: materialId,
        roll_id: rollId,
        vendor_id: input.vendor_id ? new Types.ObjectId(input.vendor_id) : undefined,
        weight: effect.weight,
        used_weight: effect.used_weight,
        material_weight_after: summary.total_weight,
        roll_weight_after: effect.roll_weight_after,
        issued_to: input.issued_to,
        from_location: effect.from_location,
        to_location: effect.to_location,
        remarks: input.remarks,
        photo_paths: input.photo_paths?.length ? input.photo_paths : undefined,
        client_id: input.client_id,
        created_by: new Types.ObjectId(actingUserId),
      });
    } catch (err) {
      if (!isReplayCollision(err)) throw err;
      const winner = await resolveReplay(StockTransaction, input.client_id!, err);
      await winner.populate(REF_POPULATE);
      return toResponse(winner as unknown as PopulatedTransaction);
    }

    await transaction.populate(REF_POPULATE);
    return toResponse(transaction as unknown as PopulatedTransaction);
  },

  async listMovements(query: {
    material_id?: string;
    roll_id?: string;
    roll_number?: string;
    transaction_type?: TransactionType;
    updated_after?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const filter: FilterQuery<IStockTransaction> = {};
    if (query.updated_after) filter.updatedAt = { $gt: query.updated_after };
    if (query.material_id) filter.material_id = new Types.ObjectId(query.material_id);
    if (query.roll_id) filter.roll_id = query.roll_id;
    if (query.transaction_type) filter.transaction_type = query.transaction_type;

    // A phone that scanned a barcode has the printed number, never an ObjectId. Resolved
    // to the id here rather than left to the client as a second round trip.
    if (query.roll_number) {
      const roll = await MaterialRoll.findOne({ roll_number: query.roll_number.toUpperCase() })
        .select("_id")
        .lean();
      // An unknown number means no history, not every movement in the store — without
      // this the filter would silently widen to unfiltered.
      if (!roll) return paginated([], 0, page, pageSize);
      filter.roll_id = roll._id;
    }

    const [items, total] = await Promise.all([
      StockTransaction.find(filter)
        // A delta pull walks forward through updatedAt; the history screen wants the
        // most recent movement first. Same reasoning as the roll list.
        .sort(query.updated_after ? { updatedAt: 1, _id: 1 } : { transaction_date: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate(REF_POPULATE)
        .lean<PopulatedTransaction[]>(),
      StockTransaction.countDocuments(filter),
    ]);

    return paginated(await Promise.all(items.map((t) => toResponse(t))), total, page, pageSize);
  },

  /**
   * Driven by the material list, not by the summary collection: a summary row only
   * appears once a material has had a roll, so reading the cache directly would make a
   * material with no stock vanish from the screen instead of showing 0.
   */
  async summary(materialId?: string) {
    const materialFilter = materialId ? { _id: new Types.ObjectId(materialId) } : {};
    const [materials, rows] = await Promise.all([
      RawMaterial.find(materialFilter).sort({ name: 1 }).lean(),
      StockSummary.find(
        materialId ? { material_id: new Types.ObjectId(materialId) } : {},
      ).lean<IStockSummary[]>(),
    ]);

    const byMaterial = new Map(rows.map((s) => [s.material_id.toString(), s]));

    return (
      materials
        // Retired materials are hidden unless stock is still sitting against them —
        // deactivating a material must never make its remaining rolls disappear.
        .filter((m) => m.status === "active" || (byMaterial.get(m._id.toString())?.total_weight ?? 0) > 0)
        .map((m) => {
          const s = byMaterial.get(m._id.toString());
          return {
            material_id: { id: m._id.toString(), name: m.name },
            material_code: m.material_code,
            unit: m.unit,
            total_weight: s?.total_weight ?? 0,
            total_rolls: s?.total_rolls ?? 0,
            // Below the level someone set as "reorder at". Absent threshold = not tracked.
            below_reorder_level:
              m.reorder_level !== undefined && (s?.total_weight ?? 0) < m.reorder_level,
            last_updated: s?.last_updated ?? null,
          };
        })
    );
  },
};
