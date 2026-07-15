import { api } from "./client";

export interface ExportFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface GenerateExportInput extends ExportFilters {
  format: "csv" | "xlsx";
  columns?: Array<{ key: string; label: string }>;
}

function filenameFromDisposition(disposition: string | undefined, fallback: string): string {
  const match = disposition?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? fallback;
}

export const exportApi = {
  previewCount: (filters: ExportFilters) =>
    api.get<{ count: number }>("/export/preview-count", { params: filters }).then((r) => r.data.count),

  /** Requests the export and downloads it in the same call — nothing is stored server-side,
   * so there's no separate history/download-by-id step. */
  async generate(input: GenerateExportInput) {
    const res = await api.post("/export", input, { responseType: "blob" });
    const filename = filenameFromDisposition(
      res.headers["content-disposition"] as string | undefined,
      `invoices.${input.format}`,
    );
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
