import { api } from "./client";
import type { Lot, Paginated } from "../types";

/** Lots: one per delivery challan. Created here or on the tablet; the number is the server's. */
export const lotsApi = {
  list: (params: { q?: string; page?: number; pageSize?: number }) =>
    api.get<Paginated<Lot>>("/lots", { params }).then((r) => r.data),

  /** Carries the signed challan photo URL, which the list leaves out. */
  get: (id: string) => api.get<Lot>(`/lots/${id}`).then((r) => r.data),

  create: (body: { challan_no: string; challan_photo_path?: string }) =>
    api.post<Lot>("/lots", body).then((r) => r.data),

  /** The challan photo goes to the bucket's lots/ folder; the returned path is what create takes. */
  uploadChallanPhoto: (file: File) => {
    const form = new FormData();
    form.append("folder", "lots");
    form.append("file", file);
    return api
      .post<{ objectPath: string; mediaUrl: string }>("/media/upload", form)
      .then((r) => r.data.objectPath);
  },
};
