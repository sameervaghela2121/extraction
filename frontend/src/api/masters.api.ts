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
  };
}

export const vendorsApi = crud<Vendor>("/vendors");
export const locationsApi = crud<GodownLocation>("/locations");
// Path stays "/raw-materials": the backend resource is unchanged, only what the screen
// calls it. Renaming the endpoint would break the mobile app, which reads the same list.
export const materialTypesApi = crud<MaterialType>("/raw-materials");
export const remarksApi = crud<Remark>("/remarks");
