import { api } from "./client";
import type { BarcodeBatch, Paginated } from "../types";

export interface BarcodeSearchResult {
  /** The single generated code this hit resolves to — never a whole run's range. */
  code: string;
  batch: BarcodeBatch;
  /** Present when the hit came through a roll (matched on roll_number or
   *  royal_touche_code) rather than the code itself. */
  roll?: { roll_number: string; royal_touche_code?: string };
}

export interface BarcodeBatchInput {
  prefix: string;
  date: string;
  from_number: number;
  to_number: number;
  kind: "barcode" | "qr";
  widthMm: number;
  heightMm: number;
}

export const barcodeBatchesApi = {
  list: (params: { page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<BarcodeBatch>>("/barcode-batches", { params }).then((r) => r.data),
  /** Where the next run for this prefix and date starts. Server-side because it has to
   *  count runs that were removed from the list — their labels are still out there. */
  nextNumber: (params: { prefix: string; date: string }) =>
    api.get<{ next: number }>("/barcode-batches/next-number", { params }).then((r) => r.data),
  /** One code, a roll number, or a Royal Touche paper code — each hit is a single sticker,
   *  never a whole run (a paper code can be shared by several rolls, so this can come back
   *  with more than one). */
  search: (q: string) =>
    api
      .get<{ items: BarcodeSearchResult[] }>("/barcode-batches/search", { params: { q } })
      .then((r) => r.data.items),
  create: (input: BarcodeBatchInput) =>
    api.post<BarcodeBatch>("/barcode-batches", input).then((r) => r.data),
  remove: (id: string) => api.delete(`/barcode-batches/${id}`).then((r) => r.data),
};
