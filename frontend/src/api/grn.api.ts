import { api } from "./client";
import type { GrnDraft, GrnItem } from "../types";

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
};
