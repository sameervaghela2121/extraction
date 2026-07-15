import { api } from "./client";
import type { DocumentDetail, DocumentListResponse } from "../types";

export interface DocumentQuery {
  search?: string;
  status?: string;
  showArchived?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export const documentsApi = {
  list: (query: DocumentQuery) =>
    api
      .get<DocumentListResponse>("/documents", {
        params: {
          ...query,
          showArchived: query.showArchived ? "true" : undefined,
        },
      })
      .then((r) => r.data),
  detail: (id: string) => api.get<DocumentDetail>(`/documents/${id}`).then((r) => r.data),
  updateFields: (id: string, fields: Record<string, string | number>) =>
    api.patch<DocumentDetail>(`/documents/${id}/fields`, { fields }).then((r) => r.data),
  verify: (id: string) => api.post(`/documents/${id}/verify`).then((r) => r.data),
  // reject: (id: string) => api.post(`/documents/${id}/reject`).then((r) => r.data),
  archive: (id: string) => api.post(`/documents/${id}/archive`).then((r) => r.data),
  restore: (id: string) => api.post(`/documents/${id}/restore`).then((r) => r.data),
  bulkVerify: (ids: string[]) => api.post("/documents/bulk/verify", { ids }).then((r) => r.data),
  // bulkReject: (ids: string[]) => api.post("/documents/bulk/reject", { ids }).then((r) => r.data),
  bulkArchive: (ids: string[]) => api.post("/documents/bulk/archive", { ids }).then((r) => r.data),
  /** Fetches the original file as an authenticated blob and returns a local object URL
   * for it — a plain <iframe src="/api/..."> can't carry the JWT header, so this is
   * needed here for the same reason exportApi.generate() fetches as a blob. */
  async getFilePreviewUrl(id: string): Promise<string> {
    const res = await api.get(`/documents/${id}/file`, { responseType: "blob" });
    return URL.createObjectURL(res.data as Blob);
  },
};
