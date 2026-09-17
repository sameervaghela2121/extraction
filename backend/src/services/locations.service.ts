import { type FilterQuery } from "mongoose";
import { Location, type ILocation, type LocationStatus } from "../models/Location.model";
import {
  escapeRegex,
  findOr404,
  ensureCodeFree,
  applyUpdates,
  nextSortOrder,
  reorderDocs,
} from "../utils/crud";

type LocationInput = {
  location_code: string;
  name: string;
  godown?: string;
  sort_order?: number;
  status?: LocationStatus;
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

export const locationsService = {
  // No pagination, same reasoning as vendors and materials: master data, read whole into
  // a picker. There will be a handful of bays, not thousands.
  async list(query: { q?: string; godown?: string; status?: LocationStatus }) {
    const filter: FilterQuery<ILocation> = {};
    if (query.status) filter.status = query.status;
    if (query.godown) filter.godown = query.godown;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ name: rx }, { location_code: rx }, { godown: rx }];
    }
    // sort_order first: a picker should follow the walk through the warehouse, not the
    // alphabet. Name breaks ties and covers rows nobody has ordered yet.
    const locations = await Location.find(filter)
      .sort({ sort_order: 1, name: 1 })
      .lean<ILocation[]>();
    return locations.map(toResponse);
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

  // Soft delete, same as materials and vendors: rolls and movements record the location
  // they were at by name, and a bay that closes must not erase where stock used to sit.
  async remove(id: string) {
    const location = await findOr404(Location, id, "location");
    location.status = "inactive";
    await location.save();
    return { id: location._id.toString(), status: location.status };
  },

  // Drag-and-drop's other half: the frontend sends every row's id in its new top-to-bottom
  // order, this stamps 1..N onto them, and the caller re-reads the list to render it.
  async reorder(ids: string[]) {
    await reorderDocs(Location, "location", ids);
    return locationsService.list({});
  },
};
