import { api } from "./client";
import type { MaterialRoll, MaterialRollListItem, Paginated } from "../types";

/** Unlike the masters, this endpoint pages server-side — rolls grow without bound, so the
 *  list is never read whole and `q` is a real query rather than an in-memory filter. */
export const rollsApi = {
  list: (params: { q?: string; page?: number; pageSize?: number }) =>
    api
      .get<Paginated<MaterialRollListItem>>("/material-rolls", { params })
      .then((r) => r.data),

  /** The full roll — the list item is deliberately narrower than this. */
  listFull: (params: {
    q?: string;
    sort?: "roll_number" | "date";
    order?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }) =>
    api.get<Paginated<MaterialRoll>>("/material-rolls", { params }).then((r) => r.data),

  get: (id: string) => api.get<MaterialRoll>(`/material-rolls/${id}`).then((r) => r.data),

  /** Never send remaining_weight, status or client_id — all three are refused with a 400.
   *  A stock figure changes through a movement, which leaves a ledger row behind it. */
  update: (id: string, body: Partial<MaterialRoll> & { material_id?: string }) =>
    api.patch<MaterialRoll>(`/material-rolls/${id}`, body).then((r) => r.data),

  /** Only while the roll is untouched. Anything else is a 409 naming the reason. */
  remove: (id: string) => api.delete(`/material-rolls/${id}`).then((r) => r.data),
};
