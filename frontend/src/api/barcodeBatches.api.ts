import { call } from "./client";
import type { BarcodeBatch, Paginated } from "../types";

export interface BarcodeSearchResult {
  /** The single generated code this hit resolves to — never a whole run's range. */
  code: string;
  batch: BarcodeBatch;
  /** Present when the hit came through a roll (matched on roll_number, royal_touche_code
   *  or a Delta code) rather than the code itself. */
  roll?: { roll_number: string; royal_touche_code?: string; delta_code?: string };
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

const M = "royal_touche.api.portal_lots.";

export const barcodeBatchesApi = {
  list: (params: { page?: number; pageSize?: number } = {}) =>
    call<Paginated<BarcodeBatch>>(`${M}list_barcode_batches`, params),
  /** Where the next run for this prefix and date starts. Server-side because it has to
   *  count runs that were removed from the list — their labels are still out there. */
  nextNumber: (params: { prefix: string; date: string }) =>
    call<{ next: number }>(`${M}barcode_next_number`, params),
  /** One code, a roll number, or a Royal Touche paper code — each hit is a single sticker,
   *  never a whole run (a paper code can be shared by several rolls, so this can come back
   *  with more than one). */
  search: (q: string) =>
    call<{ items: BarcodeSearchResult[] }>(`${M}search_barcodes`, { q }).then((r) => r.items),
  create: (input: BarcodeBatchInput) =>
    call<BarcodeBatch>(`${M}create_barcode_batch`, { ...input }, "POST"),
  /** Soft: the run leaves the list, its numbers stay spent. */
  remove: (id: string) => call<any>(`${M}remove_barcode_batch`, { id }, "POST"),
};
