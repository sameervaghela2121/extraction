import { api } from "./client";
import type { GodownLocation, MasterStatus, MaterialType, Paginated, Remark, Vendor, VendorPaper } from "../types";

/** Body of every `POST …/search`: one page of a list, searched and sorted by the server. */
export interface SearchQuery {
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
  status?: MasterStatus;
}

/** One row of the paper-codes screen: a paper, its vendor, and its position in that
 *  vendor's `papers` array — which is what an edit has to address. */
export interface PaperRow {
  vendor: { id: string; name: string; vendor_code: string };
  index: number;
  paper: VendorPaper;
}

/** The master collections are the same CRUD shape over different paths, so one factory
 *  covers all of them. `list` reads a whole master (for pickers, and what the mobile app
 *  uses); `search` is the admin panel's paged, server-searched table. */
function crud<T extends { id: string }>(path: string) {
  return {
    list: (q?: string) => api.get<T[]>(path, { params: q ? { q } : {} }).then((r) => r.data),
    search: (query: SearchQuery) => api.post<Paginated<T>>(`${path}/search`, query).then((r) => r.data),
    get: (id: string) => api.get<T>(`${path}/${id}`).then((r) => r.data),
    create: (body: Partial<T>) => api.post<T>(path, body).then((r) => r.data),
    update: (id: string, body: Partial<T>) =>
      api.patch<T>(`${path}/${id}`, body).then((r) => r.data),
    remove: (id: string) => api.delete(`${path}/${id}`).then((r) => r.data),
    // Drag-and-drop's other half: one page's ids in their new top-to-bottom order, and where
    // that page starts in the full list. Only the reorderable masters call this.
    reorder: (ids: string[], offset?: number) =>
      api.post<T[]>(`${path}/reorder`, { ids, offset }).then((r) => r.data),
  };
}

export const vendorsApi = {
  ...crud<Vendor>("/vendors"),
  /** The paper-codes screen: every vendor's papers, one row per paper, paged by the server. */
  searchPapers: (query: SearchQuery) =>
    api.post<Paginated<PaperRow>>("/vendors/papers/search", query).then((r) => r.data),
};
export const locationsApi = crud<GodownLocation>("/locations");
// Path stays "/raw-materials": the backend resource is unchanged, only what the screen
// calls it. Renaming the endpoint would break the mobile app, which reads the same list.
export const materialTypesApi = crud<MaterialType>("/raw-materials");
export const remarksApi = crud<Remark>("/remarks");
