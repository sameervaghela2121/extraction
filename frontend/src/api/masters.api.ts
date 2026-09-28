import { api } from "./client";
import type { GodownLocation, MaterialType, Remark, Vendor } from "../types";

/** The master collections are the same CRUD shape over different paths, so one factory
 *  covers all of them. None of them paginate — they are read whole into pickers. */
function crud<T extends { id: string }>(path: string) {
  return {
    list: (q?: string) => api.get<T[]>(path, { params: q ? { q } : {} }).then((r) => r.data),
    create: (body: Partial<T>) => api.post<T>(path, body).then((r) => r.data),
    update: (id: string, body: Partial<T>) =>
      api.patch<T>(`${path}/${id}`, body).then((r) => r.data),
    remove: (id: string) => api.delete(`${path}/${id}`).then((r) => r.data),
    // Drag-and-drop's other half: every row's id, in its new top-to-bottom order. Only the
    // reorderable masters (locations, material types, remarks) actually call this.
    reorder: (ids: string[]) => api.post<T[]>(`${path}/reorder`, { ids }).then((r) => r.data),
  };
}

/** The backend stores a location's state as `is_active`; the shared masters screen works in
 *  `status` like every other master, so this translates at the edge in both directions. */
type LocationWire = Omit<GodownLocation, "status"> & { is_active: boolean };

const fromWire = ({ is_active, ...rest }: LocationWire): GodownLocation => ({
  ...rest,
  status: is_active ? "active" : "inactive",
});

function toWire({ status, ...rest }: Partial<GodownLocation>): Partial<LocationWire> {
  return status === undefined ? rest : { ...rest, is_active: status === "active" };
}

const locationsCrud = crud<LocationWire>("/locations");

export const vendorsApi = crud<Vendor>("/vendors");
export const locationsApi = {
  list: (q?: string) => locationsCrud.list(q).then((rows) => rows.map(fromWire)),
  create: (body: Partial<GodownLocation>) => locationsCrud.create(toWire(body)).then(fromWire),
  update: (id: string, body: Partial<GodownLocation>) =>
    locationsCrud.update(id, toWire(body)).then(fromWire),
  remove: (id: string) =>
    locationsCrud.remove(id).then((r: LocationWire) => fromWire(r)),
  reorder: (ids: string[]) => locationsCrud.reorder(ids).then((rows) => rows.map(fromWire)),
};
// Path stays "/raw-materials": the backend resource is unchanged, only what the screen
// calls it. Renaming the endpoint would break the mobile app, which reads the same list.
export const materialTypesApi = crud<MaterialType>("/raw-materials");
export const remarksApi = crud<Remark>("/remarks");
