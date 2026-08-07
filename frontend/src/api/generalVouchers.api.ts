import { api } from "./client";
import type { DocumentDetail, DocumentListResponse } from "../types";

export interface GeneralVoucherQuery {
  search?: string;
  status?: string;
  showArchived?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export const generalVouchersApi = {
  list: (query: GeneralVoucherQuery) =>
    api
      .get<DocumentListResponse>("/general-vouchers", {
        params: {
          ...query,
          showArchived: query.showArchived ? "true" : undefined,
        },
      })
      .then((r) => r.data),
  detail: (id: string) => api.get<DocumentDetail>(`/general-vouchers/${id}`).then((r) => r.data),
  updateFields: (id: string, invoiceId: string, fields: Record<string, string | number>) =>
    api.patch<DocumentDetail>(`/general-vouchers/${id}/fields`, { invoiceId, fields }).then((r) => r.data),
  verify: (id: string) => api.post(`/general-vouchers/${id}/verify`).then((r) => r.data),
  unverify: (id: string) => api.post(`/general-vouchers/${id}/unverify`).then((r) => r.data),
  archive: (id: string) => api.post(`/general-vouchers/${id}/archive`).then((r) => r.data),
  restore: (id: string) => api.post(`/general-vouchers/${id}/restore`).then((r) => r.data),
  bulkVerify: (ids: string[]) => api.post("/general-vouchers/bulk/verify", { ids }).then((r) => r.data),
  bulkUnverify: (ids: string[]) => api.post("/general-vouchers/bulk/unverify", { ids }).then((r) => r.data),
  bulkArchive: (ids: string[]) => api.post("/general-vouchers/bulk/archive", { ids }).then((r) => r.data),
  /** Fetches the original file as an authenticated blob and returns a local object URL for it. */
  async getFilePreviewUrl(id: string): Promise<string> {
    const res = await api.get(`/general-vouchers/${id}/file`, { responseType: "blob" });
    return URL.createObjectURL(res.data as Blob);
  },
};
