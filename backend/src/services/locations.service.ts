import { Types, type FilterQuery } from "mongoose";
import { Location, type ILocation } from "../models/Location.model";
import type { MasterStatus } from "../models/masterStatus";
import type { z } from "zod";
import type { searchLocationsSchema } from "../validators/locations.validators";
import { ApiError } from "../utils/ApiError";
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

type LocationInput = {
  location_code: string;
  name: string;
  godown?: string;
  sort_order?: number;
  status?: MasterStatus;
};

const PATCHABLE = ["name", "godown", "sort_order", "status"] as const;
const CODE_TAKEN = "A location with this code already exists";

function toResponse(l: ILocation) {
  return {
    id: l._id.toString(),
    location_code: l.location_code,
    name: l.name,
    godown: l.godown,
    sort_order: l.sort_order,
    status: l.status,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

/** The fields a roll or movement response shows for its location. */
export const LOCATION_REF_SELECT = "location_code name";

export type LocationRef = { _id: Types.ObjectId; location_code: string; name: string };

/** Null when there is no location (a roll returned to its vendor). An unpopulated id (a
 *  location that no longer resolves) still returns the id, with nulls beside it. */
export function locationRefResponse(ref?: Types.ObjectId | LocationRef | null) {
  if (!ref) return null;
  if (ref instanceof Types.ObjectId) return { id: ref.toString(), location_code: null, name: null };
  return { id: ref._id.toString(), location_code: ref.location_code, name: ref.name };
}

/** A roll can only be put at a location that exists and is still in use. */
export async function loadUsableLocation(id: string): Promise<LocationRef> {
  const location = await Location.findById(id).select(`${LOCATION_REF_SELECT} status`).lean();
  if (!location) throw ApiError.badRequest("That location no longer exists — pick another");
  if (location.status !== "active") {
    throw ApiError.badRequest(`${location.name} is inactive — pick a different location`);
  }
  return location;
}

/** Shared by the GET list (the app's picker) and the admin panel's paged search. */
function filterOf(query: { q?: string; godown?: string; status?: MasterStatus }): FilterQuery<ILocation> {
  const filter: FilterQuery<ILocation> = {};
  if (query.status) filter.status = query.status;
  if (query.godown) filter.godown = query.godown;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ name: rx }, { location_code: rx }, { godown: rx }];
  }
  return filter;
}

/** What each sortable column sorts by. sort_order — the walk through the warehouse — is the
 *  default, with name breaking ties the same way the GET list does. */
const SORTS: Record<NonNullable<z.infer<typeof searchLocationsSchema>["sort"]>, SortSpec> = {
  sort_order: { sort_order: 1, name: 1 },
  location_code: { location_code: 1 },
  name: { name: 1 },
};

export const locationsService = {
  // No pagination, same reasoning as vendors and materials: master data, read whole into
  // a picker. There will be a handful of bays, not thousands.
  async list(query: { q?: string; godown?: string; status?: MasterStatus }) {
    const filter = filterOf(query);
    // sort_order first: a picker should follow the walk through the warehouse, not the
    // alphabet. Name breaks ties and covers rows nobody has ordered yet.
    const locations = await Location.find(filter)
      .sort({ sort_order: 1, name: 1 })
      .lean<ILocation[]>();
    return locations.map(toResponse);
  },

  /** One page for the admin panel: filtered, sorted and paged in the database. */
  async search(input: z.infer<typeof searchLocationsSchema>) {
    const { items, total } = await pagedAggregate<ILocation>(Location, [{ $match: filterOf(input) }], {
      sort: directed(SORTS[input.sort ?? "sort_order"], input.order),
      page: input.page,
      pageSize: input.pageSize,
    });
    return paginated(items.map(toResponse), total, input.page, input.pageSize);
  },

  async get(id: string) {
    return toResponse(await findOr404(Location, id, "location"));
  },

  async create(input: LocationInput) {
    const code = input.location_code.toUpperCase();
    await ensureCodeFree(Location, "location_code", code, CODE_TAKEN);
    // Auto-assigned unless the caller already sent one (a seed script restoring known
    // positions, say) — the picker has no manual "type a number" field any more.
    const sort_order = input.sort_order ?? (await nextSortOrder(Location));
    const location = await Location.create({ ...input, location_code: code, sort_order });
    return toResponse(location);
  },

  async update(id: string, updates: Partial<LocationInput>) {
    const location = await findOr404(Location, id, "location");
    if (updates.location_code) {
      const code = updates.location_code.toUpperCase();
      if (code !== location.location_code) {
        await ensureCodeFree(Location, "location_code", code, CODE_TAKEN);
        location.location_code = code;
      }
    }
    applyUpdates(location, updates, PATCHABLE);
    await location.save();
    return toResponse(location);
  },

  // Soft delete, same as materials and vendors: rolls and movements reference the location,
  // and a bay that closes must not erase where stock used to sit.
  async remove(id: string) {
    const location = await findOr404(Location, id, "location");
    location.status = "inactive";
    await location.save();
    return { id: location._id.toString(), status: location.status };
  },

  // Drag-and-drop's other half: the frontend sends every row's id in its new top-to-bottom
  // order, this stamps 1..N onto them, and the caller re-reads the list to render it.
  async reorder(ids: string[], offset?: number) {
    await reorderDocs(Location, "location", ids, offset === undefined ? undefined : { offset, sort: SORTS.sort_order });
    return locationsService.list({});
  },
};
