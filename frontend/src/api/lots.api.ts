import { api } from "./client";
import type { Lot, LotDocumentType, Paginated } from "../types";

/** Lots: one per delivery, known by its challan or invoice. Created here or on the tablet. */
export const lotsApi = {
  list: (params: { q?: string; page?: number; pageSize?: number }) =>
    api.get<Paginated<Lot>>("/lots", { params }).then((r) => r.data),

  /** Carries the signed document photo URL, which the list leaves out. */
  get: (id: string) => api.get<Lot>(`/lots/${id}`).then((r) => r.data),

  create: (body: { document_type: LotDocumentType; document_no: string; document_photo_path?: string }) =>
    api.post<Lot>("/lots", body).then((r) => r.data),

  /** The challan / invoice photo goes to the bucket's lots/ folder; the returned path is what
   *  create takes. */
  uploadDocumentPhoto: (file: File) => {
    const form = new FormData();
    form.append("folder", "lots");
    form.append("file", file);
    return api
      .post<{ objectPath: string; mediaUrl: string }>("/media/upload", form)
      .then((r) => r.data.objectPath);
  },
};
