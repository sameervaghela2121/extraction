import { call } from "./client";
import type { GodownLocation, MasterStatus, MaterialType, Paginated, Remark, Vendor, VendorPaper } from "../types";

/** Arguments of every `…_search`: one page of a list, searched and sorted by the server. */
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

/** The backend's master methods: royal_touche.api.portal_masters.<master>_<action>. */
const METHODS = "royal_touche.api.portal_masters.";

/** The master collections are the same CRUD shape over different methods, so one factory
 *  covers all of them. `list` reads a whole master (for pickers); `search` is the admin
 *  panel's paged, server-searched table. */
function crud<T extends { id: string }>(master: string) {
  const method = (action: string) => `${METHODS}${master}_${action}`;
  return {
    list: (q?: string) => call<T[]>(method("list"), q ? { q } : {}),
    search: (query: SearchQuery) => call<Paginated<T>>(method("search"), { ...query }),
    get: (id: string) => call<T>(method("get"), { id }),
    create: (body: Partial<T>) => call<T>(method("create"), { body }, "POST"),
    update: (id: string, body: Partial<T>) => call<T>(method("update"), { id, body }, "POST"),
    // A soft delete: the record stays, inactive. Answers { id, status }.
    remove: (id: string) => call<unknown>(method("remove"), { id }, "DELETE"),
    // Drag-and-drop's other half: one page's ids in their new top-to-bottom order, and where
    // that page starts in the full list. Only the reorderable masters call this.
    reorder: (ids: string[], offset?: number) => call<T[]>(method("reorder"), { ids, offset }, "POST"),
  };
}

export const vendorsApi = {
  ...crud<Vendor>("vendors"),
  /** The vendor table: vendors without their papers, which have their own screen. */
  search: (query: SearchQuery) => call<Paginated<Omit<Vendor, "papers">>>(`${METHODS}vendors_search`, { ...query }),
  /** The paper-codes screen: every vendor's papers, one row per paper, paged by the server. */
  searchPapers: (query: SearchQuery) => call<Paginated<PaperRow>>(`${METHODS}vendors_search_papers`, { ...query }),
};
export const locationsApi = crud<GodownLocation>("locations");
// The screen calls them material types; on the backend they are ERPNext Items.
export const materialTypesApi = crud<MaterialType>("materials");
export const remarksApi = crud<Remark>("remarks");
