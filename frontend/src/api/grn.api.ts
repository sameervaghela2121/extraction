import { api } from "./client";
import type { GrnDetail, GrnDraft, GrnItem, GrnListResponse, GrnStatus } from "../types";

export interface SaveGrnInput {
  documentId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  items: GrnItem[];
}

export const grnApi = {
  /** Poll target while extraction runs; also carries the lean invoice data once it's done. */
  draft: (documentIds: string[]) =>
    api
      .get<GrnDraft>("/grn/draft", { params: { documentIds: documentIds.join(",") } })
      .then((r) => r.data),

  save: (input: SaveGrnInput) => api.post("/grn", input).then((r) => r.data),

  list: (page: number, pageSize = 10, search?: string) =>
    api
      .get<GrnListResponse>("/grn", { params: { page, pageSize, search: search || undefined } })
      .then((r) => r.data),

  detail: (id: string) => api.get<GrnDetail>(`/grn/${id}`).then((r) => r.data),

  setStatus: (id: string, status: GrnStatus) =>
    api.patch(`/grn/${id}/status`, { status }).then((r) => r.data),

  /** Staff-only correction of an already-saved GRN's received quantities — one number
   *  per item, position-matched. Nothing else on the GRN is editable this way. */
  updateQuantities: (id: string, quantities: number[]) =>
    api.patch(`/grn/${id}/quantities`, { quantities }).then((r) => r.data),
};
