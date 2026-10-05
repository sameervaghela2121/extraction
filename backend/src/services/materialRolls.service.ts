import { Types, type FilterQuery, type HydratedDocument } from "mongoose";
import { MaterialRoll, type IMaterialRoll, type RollStatus } from "../models/MaterialRoll.model";
import { StockTransaction } from "../models/StockTransaction.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { Vendor, paperKey, type IBasePaper } from "../models/Vendor.model";
import { Remark } from "../models/Remark.model";
import type { MasterStatus } from "../models/masterStatus";
import { ApiError } from "../utils/ApiError";
import { escapeRegex, ensureCodeFree, applyUpdates, paginated } from "../utils/crud";
import { findReplay, isReplayCollision, resolveReplay } from "../utils/idempotency";
import { refreshSummaries, refreshSummary } from "./stockSummary.service";
import { mediaService } from "./media.service";
import {
  LOCATION_REF_SELECT,
  loadUsableLocation,
  locationRefResponse,
  type LocationRef,
} from "./locations.service";

type RollInput = {
  roll_number: string;
  /** Input only: an RT code to look the paper up by, from a client that doesn't send
   *  `papers` (older app versions). Never stored — see resolvePapers. */
  royal_touche_code?: string;
  /** Papers picked from the vendor's list. Resolved against the vendor — see resolvePapers. */
  papers?: IBasePaper[];
  /** The pre-printed label scanned onto the roll. */
  barcode?: string;
  /** A code from the remark master, noted at registration. */
  remark_code?: string;
  /** The note in the operator's own words. */
  remarks?: string;
  material_id: string;
  vendor_id: string;
  batch_no?: string;
  weight: number;
  remaining_weight?: number;
  quantity?: number;
  unit?: string;
  gsm: number;
  width: number;
  location: string;
  date: string;
  status?: RollStatus;
  tag_photo_path?: string;
  stitched_barcode_photo_path?: string;
  side1_photo_path?: string;
  side2_photo_path?: string;
  /** Offline flush: the device's id for this queued registration. See create. */
  client_id?: string;
};

/** The four photo slots, in the order the registration flow captures them. */
const PHOTO_FIELDS = [
  "tag_photo_path",
  "stitched_barcode_photo_path",
  "side1_photo_path",
  "side2_photo_path",
] as const;

// status is deliberately absent: it follows the roll's movements. remaining_weight is here
// because correcting a mistyped figure is a correction, not a movement — see updateRollSchema.
const PATCHABLE = [
  "remaining_weight",
  // Correctable like roll_number: read off the label, so it can be mistyped. The paper
  // (and its RT code) changes through `papers` instead — see update().
  "barcode",
  "remark_code",
  "remarks",
  "batch_no",
  "weight",
  "quantity",
  "unit",
  "gsm",
  "width",
  ...PHOTO_FIELDS,
] as const;
const ROLL_TAKEN = "A roll with this number already exists";

/** The roll's photo slots as a plain list, for the receipt movement. Undefined rather
 *  than [] when none were taken — the ledger stores the field only when it has one. */
function registrationPhotos(roll: Pick<IMaterialRoll, (typeof PHOTO_FIELDS)[number]>) {
  const paths = PHOTO_FIELDS.map((field) => roll[field]).filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return paths.length ? paths : undefined;
}

/** What .populate leaves behind in place of the ObjectId. vendor_code only on the vendor,
 *  where it is the Supplier Code Number the form shows. */
type NamedRef = { _id: Types.ObjectId; name: string; vendor_code?: string };

/** What .populate leaves behind in place of a remark_codes entry. */
type RemarkRef = { _id: Types.ObjectId; remark_code: string; label: string; status: MasterStatus };

// Only the two ref paths, and only the fields the roll screens render — a roll list
// shouldn't drag whole vendor and material documents across the wire.
const REF_POPULATE = [
  { path: "material_id", select: "name" },
  { path: "vendor_id", select: "name vendor_code" },
  { path: "remark_codes", select: "remark_code label status" },
  { path: "location", select: LOCATION_REF_SELECT },
];

function refResponse(ref?: Types.ObjectId | NamedRef) {
  if (!ref) return undefined;
  // `id`, not `_id` — every other response in this codebase exposes it that way.
  // Unpopulated (a ref whose target was deleted) still returns the id, never null.
  if (ref instanceof Types.ObjectId) return { id: ref.toString(), name: null };
  // vendor_code is present only on the vendor ref; the material ref omits the key.
  return ref.vendor_code === undefined
    ? { id: ref._id.toString(), name: ref.name }
    : { id: ref._id.toString(), name: ref.name, vendor_code: ref.vendor_code };
}

/** Same "id, never null, even unpopulated" rule as refResponse — a remark hard-deleted out
 *  from under a roll (masters here are soft-deleted, so this shouldn't happen, but a ref
 *  is still just an id with no guarantee behind it) leaves the id with nulls beside it
 *  rather than silently dropping the entry. */
function remarkRefResponse(refs?: Array<Types.ObjectId | RemarkRef>) {
  if (!refs || refs.length === 0) return undefined;
  return refs.map((ref) =>
    ref instanceof Types.ObjectId
      ? { id: ref.toString(), remark_code: null, label: null, status: null }
      : { id: ref._id.toString(), remark_code: ref.remark_code, label: ref.label, status: ref.status },
  );
}

type PopulatedRoll = Omit<IMaterialRoll, "material_id" | "vendor_id" | "remark_codes" | "location"> & {
  material_id: Types.ObjectId | NamedRef;
  vendor_id?: Types.ObjectId | NamedRef;
  remark_codes?: Array<Types.ObjectId | RemarkRef>;
  location: Types.ObjectId | LocationRef | null;
};

async function toResponse(r: PopulatedRoll) {
  // Signing is local crypto, no network call, so four per roll is cheap.
  const [tag, stitched, side1, side2] = await Promise.all(
    PHOTO_FIELDS.map((field) => mediaService.signedReadUrlOrNull(r[field])),
  );

  return {
    id: r._id.toString(),
    roll_number: r.roll_number,
    // Not stored — derived from the papers, so it can never disagree with them. Kept in
    // the response so every client that reads it (the app, labels) works unchanged.
    royal_touche_code: royalToucheCodeOf(r.papers),
    // `[]` rather than undefined so a client can map over it without a guard — same as a
    // vendor's papers.
    papers: r.papers ?? [],
    barcode: r.barcode,
    remark_code: r.remark_code,
    remarks: r.remarks,
    remark_codes: remarkRefResponse(r.remark_codes),
    material_id: refResponse(r.material_id),
    vendor_id: refResponse(r.vendor_id),
    batch_no: r.batch_no,
    weight: r.weight,
    remaining_weight: r.remaining_weight,
    quantity: r.quantity,
    unit: r.unit,
    gsm: r.gsm,
    width: r.width,
    location: locationRefResponse(r.location),
    date: r.date,
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
    // Echoed back so a device pulling a delta can match rolls against its own outbox and
    // drop the queued copies. Absent on anything registered from the portal.
    client_id: r.client_id,
    createdAt: r.createdAt,
    // The delta-pull checkpoint the client sends back as updated_after.
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

/** The looked-up master, so a caller that needs its name does not fetch it twice. */
type UsableRef = NamedRef | undefined;

async function loadUsableMaterial(materialId?: string): Promise<UsableRef> {
  if (!materialId) return undefined;
  const material = await RawMaterial.findById(materialId).select("status name").lean();
  if (!material) throw ApiError.badRequest("That material no longer exists — pick another");
  if (material.status !== "active") {
    throw ApiError.badRequest(`${material.name} is inactive — reactivate it before booking stock against it`);
  }
  return material;
}

type VendorWithPapers = { name: string; papers?: IBasePaper[] };

// vendor_code as well as the name: roll screens show it as the Supplier Code Number. Papers
// too, so registration can resolve the picked paper without a second round trip.
async function loadUsableVendor(
  vendorId?: string,
): Promise<(NamedRef & { vendor_code: string; papers?: IBasePaper[] }) | undefined> {
  if (!vendorId) return undefined;
  const vendor = await Vendor.findById(vendorId).select("status name vendor_code papers").lean();
  if (!vendor) throw ApiError.badRequest("That vendor no longer exists — pick another");
  if (vendor.status !== "active") {
    throw ApiError.badRequest(`${vendor.name} is inactive — pick a different vendor`);
  }
  return vendor;
}

/**
 * The papers to store on a roll, resolved against its vendor.
 *
 * Each picked paper is found on the vendor by its RT code, or by its Delta code when it has
 * none, and the vendor's own copy is what gets stored: the client only chooses which paper,
 * never what that paper says. A paper the vendor doesn't have is refused.
 *
 * With nothing picked, a bare royal_touche_code (all an older app version sends) is looked
 * up the same way and its paper filled in. A code the vendor doesn't have is refused as
 * well: the roll no longer stores the code on its own, so accepting it would drop it.
 */
function resolvePapers(
  vendor: VendorWithPapers,
  picked: IBasePaper[] | undefined,
  royalToucheCode: string | undefined,
): IBasePaper[] | undefined {
  const own = vendor.papers ?? [];
  const same = (a?: string, b?: string) => Boolean(a && b && a.toUpperCase() === b.toUpperCase());
  const find = (p: Pick<IBasePaper, "royal_touche_code" | "delta_code">) =>
    p.royal_touche_code
      ? own.find((v) => same(v.royal_touche_code, p.royal_touche_code))
      : own.find((v) => same(v.delta_code, p.delta_code));

  if (!picked?.length) {
    if (!royalToucheCode) return undefined;
    const match = find({ royal_touche_code: royalToucheCode });
    if (!match) {
      throw ApiError.badRequest(`Paper RT ${royalToucheCode} is not one of ${vendor.name}'s papers`);
    }
    return [{ ...match }];
  }

  // Keyed so the same paper picked twice is stored once.
  const resolved = new Map<string, IBasePaper>();
  for (const p of picked) {
    const match = find(p);
    if (!match) {
      const code = p.royal_touche_code ? `RT ${p.royal_touche_code}` : `Delta ${p.delta_code}`;
      throw ApiError.badRequest(`Paper ${code} is not one of ${vendor.name}'s papers`);
    }
    resolved.set(paperKey(match), { ...match });
  }
  return [...resolved.values()];
}

/** The roll's RT code, as responses show it: the first of its papers that has one. */
function royalToucheCodeOf(papers: IBasePaper[] | undefined) {
  return papers?.find((p) => p.royal_touche_code)?.royal_touche_code;
}

async function assertRefsUsable(materialId?: string, vendorId?: string) {
  // Both checks at once: they are independent, and each is a round trip to Atlas.
  await Promise.all([loadUsableMaterial(materialId), loadUsableVendor(vendorId)]);
}

/**
 * Keep the ledger's most recent row in step with the roll it describes.
 *
 * That row's `roll_weight_after` IS the running balance a history reads down to, so a
 * corrected figure leaves the last line stating a weight the roll no longer holds. Corrected
 * in place rather than appended: nothing moved, so there is no movement to record.
 *
 * Whether `weight` follows depends on what that row's `weight` MEANS, which differs by type:
 *
 *   IN (alone)   what arrived. Equals the balance on an untouched roll, and is simply wrong
 *                if the arrival weight was mistyped — so it follows.
 *   OUT          the whole roll leaving the store. Equal to the balance by construction, so
 *                leaving it behind produces "Issued out 300 kg" on a roll holding 250.
 *   RETURN       what came back, which IS the new balance. Follows, and drags used_weight
 *                with it.
 *   IN (later)   the amount added back — unrelated to the balance. Left alone.
 *   ADJUSTMENT   a delta. CONSUME: what was used up. Neither becomes false because the
 *                roll's figure was corrected, so both are left alone.
 *
 * Ordered the way the history screen reads (transaction_date, then _id), so "the last row"
 * is the one a user sees at the top of that list.
 */
async function syncLastLedgerRow(roll: HydratedDocument<IMaterialRoll>): Promise<void> {
  // Two rows: the one to correct, and the one before it — a RETURN needs its predecessor's
  // balance to work out what the line consumed.
  const rows = await StockTransaction.find({ roll_id: roll._id })
    .sort({ transaction_date: -1, _id: -1 })
    .select("transaction_type roll_weight_after")
    .limit(2)
    .lean();
  const last = rows[0];
  // A roll old enough to predate the automatic registration row has nothing to correct.
  if (!last) return;

  const balance = roll.remaining_weight;
  const fields: Record<string, unknown> = { roll_weight_after: balance };

  if (last.transaction_type === "IN" && rows.length === 1) {
    // The registration row, and the whole ledger: its weight is what arrived.
    fields.weight = roll.weight;
  } else if (last.transaction_type === "OUT" || last.transaction_type === "RETURN") {
    fields.weight = balance;
  }

  if (last.transaction_type === "RETURN") {
    // used = what the roll held before it went out, less what came back.
    const before = rows[1]?.roll_weight_after;
    if (before !== undefined && balance !== undefined) {
      // Clamped: a correction that would make the line consume a negative amount means the
      // figures disagree, and 0 is the honest floor rather than a nonsense number.
      fields.used_weight = Math.max(0, before - balance);
    }
  }

  await StockTransaction.updateOne({ _id: last._id }, { $set: fields });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const materialRollsService = {
  // Paginated, unlike the masters: rolls grow without bound.
  async list(query: {
    q?: string;
    material_id?: string;
    vendor_id?: string;
    status?: RollStatus;
    location?: string;
    remark_id?: string;
    updated_after?: Date;
    date_from?: string;
    date_to?: string;
    sort?: "roll_number" | "date";
    order?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const filter: FilterQuery<IMaterialRoll> = {};
    if (query.status) filter.status = query.status;
    if (query.updated_after) filter.updatedAt = { $gt: query.updated_after };
    if (query.material_id) filter.material_id = new Types.ObjectId(query.material_id);
    if (query.vendor_id) filter.vendor_id = new Types.ObjectId(query.vendor_id);
    if (query.location) filter.location = new Types.ObjectId(query.location);
    // remark_codes is an array field — Mongo matches a scalar against it as "array contains
    // this value" with no operator needed, same as every equality filter above.
    if (query.remark_id) filter.remark_codes = new Types.ObjectId(query.remark_id);
    if (query.date_from || query.date_to) {
      const range: { $gte?: Date; $lt?: Date; $lte?: Date } = {};
      if (query.date_from) range.$gte = new Date(query.date_from);
      if (query.date_to) {
        // A plain day is stored as that day's UTC midnight, so an inclusive "up to the
        // 5th" means everything before the 6th starts. An instant is taken as given.
        if (DATE_ONLY.test(query.date_to)) {
          const end = new Date(query.date_to);
          end.setUTCDate(end.getUTCDate() + 1);
          range.$lt = end;
        } else {
          range.$lte = new Date(query.date_to);
        }
      }
      filter.date = range;
    }
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [
        { roll_number: rx },
        { "papers.royal_touche_code": rx },
        { "papers.delta_code": rx },
        { "papers.supplier_code_number": rx },
        { barcode: rx },
        { batch_no: rx },
      ];
    }

    const [items, total] = await Promise.all([
      MaterialRoll.find(filter)
        // A delta pull walks forward through updatedAt and cannot be reordered — the
        // client checkpoints on the last row it saw, so any other order breaks resuming.
        // Otherwise: whatever the caller asked for, defaulting to newest received first.
        // _id breaks ties so two rolls saved in the same millisecond cannot swap places
        // between pages and hide one of themselves.
        .sort(
          query.updated_after
            ? { updatedAt: 1, _id: 1 }
            : query.sort
              ? { [query.sort]: query.order === "asc" ? 1 : -1, _id: 1 }
              : { date: -1, _id: -1 },
        )
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
    // Before anything else, including the roll_number check. A phone re-flushing a
    // registration whose response it never received must get its roll back — running
    // ensureCodeFree first would answer "a roll with this number already exists", which
    // is that same roll, and would wedge the device's queue on an item it can never
    // drain. The replay check has to shadow the uniqueness check, not follow it.
    const replayed = await findReplay(MaterialRoll, input.client_id);
    if (replayed) {
      await replayed.populate(REF_POPULATE);
      return toResponse(replayed as unknown as PopulatedRoll);
    }

    const rollNumber = input.roll_number.toUpperCase();
    // Three independent reads, so one round trip instead of three. Registration happens
    // on a phone over mobile data, where every avoidable trip to Atlas is felt.
    // Promise.all rejects on the first failure, which is the behaviour the sequential
    // version had: the caller sees whichever check failed.
    const [, material, vendor, location] = await Promise.all([
      ensureCodeFree(MaterialRoll, "roll_number", rollNumber, ROLL_TAKEN),
      loadUsableMaterial(input.material_id),
      loadUsableVendor(input.vendor_id),
      loadUsableLocation(input.location),
    ]);

    const papers = vendor ? resolvePapers(vendor, input.papers, input.royal_touche_code) : undefined;

    // A newly received roll is full unless the caller says otherwise.
    const remaining = input.remaining_weight ?? input.weight;
    if (remaining > input.weight) {
      throw ApiError.badRequest(
        `A roll cannot hold more than the ${input.weight} ${input.unit ?? "kg"} it arrived with`,
      );
    }

    let roll: HydratedDocument<IMaterialRoll>;
    try {
      // royal_touche_code is input only — it chose the paper above, and isn't stored.
      const { royal_touche_code: _lookupCode, ...fields } = input;
      roll = await MaterialRoll.create({
        ...fields,
        roll_number: rollNumber,
        // The vendor's copies, never the client's — see resolvePapers.
        papers,
        // Read off the label: read off the label, uppercased so a scan and a typed code match.
        barcode: input.barcode?.toUpperCase(),
        remaining_weight: remaining,
      });
    } catch (err) {
      // Two flushes of the same queued registration, in flight at once: both read "no
      // replay" above, both got here, and the unique index let exactly one through. The
      // loser returns the winner's roll. The winner is mid-flight, so it — not this
      // request — writes the receipt row and refreshes the summary.
      if (!isReplayCollision(err)) throw err;
      const winner = await resolveReplay(MaterialRoll, input.client_id!, err);
      await winner.populate(REF_POPULATE);
      return toResponse(winner as unknown as PopulatedRoll);
    }
    // A new roll changes what's on hand, so the material's cached totals must follow it.
    const summary = await refreshSummary(roll.material_id);

    await StockTransaction.create({
      transaction_type: "IN",
      // Dated when the roll arrived, not when it was keyed in — a roll entered a week
      // late must still land in the right place in the history.
      transaction_date: roll.date,
      material_id: roll.material_id,
      roll_id: roll._id,
      vendor_id: roll.vendor_id,
      weight: roll.remaining_weight ?? 0,
      material_weight_after: summary.total_weight,
      roll_weight_after: roll.remaining_weight,
      remarks: `Roll ${roll.roll_number} received`,
      // The registration photos, carried onto the receipt row so the history shows the
      // roll as it arrived — the same way an OUT and a RETURN carry theirs. Without this
      // the IN is the one movement in the ledger with nothing to look at.
      photo_paths: registrationPhotos(roll),
      created_by: new Types.ObjectId(actingUserId),
    });

    // No populate: the masters were already read by the checks above, so asking Mongo for
    // them again would be more round trips for documents we hold.
    return toResponse({
      ...(roll.toObject() as unknown as PopulatedRoll),
      material_id: material ?? roll.material_id,
      vendor_id: vendor ?? roll.vendor_id,
      location,
    });
  },

  async update(id: string, updates: Partial<RollInput>) {
    const roll = await findRoll(id);
    // Remembered before the update: if the roll is re-pointed at another material, both
    // the old and the new material's totals change.
    const previousMaterialId = roll.material_id;
    // Remembered so the ledger's last row can follow a corrected figure — see syncLastLedgerRow.
    const previousWeight = roll.weight;
    const previousRemaining = roll.remaining_weight;
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
    const changedLocation =
      updates.location && updates.location !== roll.location?.toString() ? updates.location : undefined;
    await Promise.all([
      assertRefsUsable(changedMaterial, changedVendor),
      changedLocation ? loadUsableLocation(changedLocation) : undefined,
    ]);

    if (updates.material_id !== undefined) roll.material_id = new Types.ObjectId(updates.material_id);
    if (updates.vendor_id !== undefined) roll.vendor_id = new Types.ObjectId(updates.vendor_id);
    if (changedLocation) roll.location = new Types.ObjectId(changedLocation);
    applyUpdates(roll, updates, PATCHABLE);
    // Not in PATCHABLE: these arrive as strings and need converting first.
    if (updates.date !== undefined) roll.date = new Date(updates.date);

    // A new paper, as `papers` or as a bare RT code (resolved the same way as at
    // registration). Resolved against whichever vendor the roll now points at; not required
    // to be active — correcting an old roll's paper must still work once its vendor retired.
    if (updates.papers !== undefined || updates.royal_touche_code !== undefined) {
      const vendor = await Vendor.findById(roll.vendor_id).select("name papers").lean();
      if (!vendor) throw ApiError.badRequest("That vendor no longer exists — pick another");
      roll.papers = resolvePapers(vendor, updates.papers, updates.royal_touche_code);
    }

    if (
      roll.remaining_weight !== undefined &&
      roll.weight !== undefined &&
      roll.remaining_weight > roll.weight
    ) {
      throw ApiError.badRequest(
        `A roll cannot hold more than the ${roll.weight} ${roll.unit} it arrived with`,
      );
    }
    await roll.save();

    // After the save, so a rejected write cannot leave the ledger corrected for a change
    // the roll never took.
    if (roll.weight !== previousWeight || roll.remaining_weight !== previousRemaining) {
      await syncLastLedgerRow(roll);
    }

    await refreshSummaries([previousMaterialId, roll.material_id]);
    await roll.populate(REF_POPULATE);
    return toResponse(roll as unknown as PopulatedRoll);
  },

  /** Replaces the roll's remark_codes wholesale — the caller sends the complete set it
   *  wants, not a delta. Kept off the general update endpoint because this list gets
   *  revised long after registration, by whoever is looking at the roll that day, not by
   *  the flow that filled in the rest of the form.
   *
   *  Ids, not codes — see updateRollRemarkCodesSchema. Existence is checked here rather
   *  than left to the ref alone, so a typo'd or already-deleted id is rejected outright
   *  instead of saving a reference to nothing. */
  async updateRemarkCodes(id: string, remarkIds: string[]) {
    const roll = await findRoll(id);
    // De-duplicated here rather than left to Mongo, so the same remark picked twice in one
    // request collapses to one entry instead of the array growing duplicates.
    const ids = [...new Set(remarkIds)];
    if (ids.length) {
      const found = await Remark.countDocuments({ _id: { $in: ids } });
      if (found !== ids.length) {
        throw ApiError.badRequest("One or more remarks don't exist");
      }
    }
    // Undefined rather than [], matching remark_codes' own "unset, not empty" convention.
    roll.remark_codes = ids.length ? ids.map((remarkId) => new Types.ObjectId(remarkId)) : undefined;
    await roll.save();
    await roll.populate(REF_POPULATE);
    return toResponse(roll as unknown as PopulatedRoll);
  },

  // Hard delete, unlike the masters: this is for a mis-scanned roll that never
  // existed. Once any of it has been issued, the roll is history and must stay.
  async remove(id: string) {
    const roll = await findRoll(id);
    await roll.deleteOne();
    await StockTransaction.deleteMany({ roll_id: roll._id });
    await refreshSummaries([roll.material_id]);
    return { id, deleted: true };
  },
};
