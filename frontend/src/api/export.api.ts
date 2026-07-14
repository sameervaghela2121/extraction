import { api } from "./client";
import type { ExportHistoryItem } from "../types";

export interface ExportFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface GenerateExportInput extends ExportFilters {
  format: "csv" | "xlsx";
  columns?: Array<{ key: string; label: string }>;
}

export const exportApi = {
  previewCount: (filters: ExportFilters) =>
    api.get<{ count: number }>("/export/preview-count", { params: filters }).then((r) => r.data.count),
  generate: (input: GenerateExportInput) =>
    api.post<ExportHistoryItem>("/export", input).then((r) => r.data),
  history: () => api.get<ExportHistoryItem[]>("/export/history").then((r) => r.data),
  async download(id: string, filename: string) {
    const res = await api.get(`/export/${id}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
