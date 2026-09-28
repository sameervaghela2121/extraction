import { api } from "./client";
import type { GodownLocation, MasterStatus, MaterialType, Remark, Vendor } from "../types";

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

/** The backend stores every master's state as `is_active`; the shared masters screen (and
 *  every MasterSpec) works in `status`, so this translates at the edge in both directions
 *  for whichever master is asking. */
function crudWithStatus<T extends { id: string; status: MasterStatus }>(path: string) {
  type Wire = Omit<T, "status"> & { is_active: boolean };
  const inner = crud<Wire>(path);

  const fromWire = ({ is_active, ...rest }: Wire): T =>
    ({ ...rest, status: is_active ? "active" : "inactive" }) as unknown as T;

  const toWire = ({ status, ...rest }: Partial<T>): Partial<Wire> =>
    (status === undefined ? rest : { ...rest, is_active: status === "active" }) as Partial<Wire>;

  return {
    list: (q?: string) => inner.list(q).then((rows) => rows.map(fromWire)),
    create: (body: Partial<T>) => inner.create(toWire(body)).then(fromWire),
    update: (id: string, body: Partial<T>) => inner.update(id, toWire(body)).then(fromWire),
    remove: (id: string) => inner.remove(id).then((r) => fromWire(r as Wire)),
    reorder: (ids: string[]) => inner.reorder(ids).then((rows) => rows.map(fromWire)),
  };
}

export const vendorsApi = crudWithStatus<Vendor>("/vendors");
export const locationsApi = crudWithStatus<GodownLocation>("/locations");
// Path stays "/raw-materials": the backend resource is unchanged, only what the screen
// calls it. Renaming the endpoint would break the mobile app, which reads the same list.
export const materialTypesApi = crudWithStatus<MaterialType>("/raw-materials");
export const remarksApi = crudWithStatus<Remark>("/remarks");
