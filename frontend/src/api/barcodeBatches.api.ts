import { api } from "./client";
import type { BarcodeBatch, Paginated } from "../types";

export interface BarcodeBatchInput {
  prefix: string;
  date: string;
  from_number: number;
  to_number: number;
}

export const barcodeBatchesApi = {
  list: (params: { page?: number; pageSize?: number } = {}) =>
    api.get<Paginated<BarcodeBatch>>("/barcode-batches", { params }).then((r) => r.data),
  /** Where the next run for this prefix and date starts. Server-side because it has to
   *  count runs that were removed from the list — their labels are still out there. */
  nextNumber: (params: { prefix: string; date: string }) =>
    api.get<{ next: number }>("/barcode-batches/next-number", { params }).then((r) => r.data),
  create: (input: BarcodeBatchInput) =>
    api.post<BarcodeBatch>("/barcode-batches", input).then((r) => r.data),
  remove: (id: string) => api.delete(`/barcode-batches/${id}`).then((r) => r.data),
};
