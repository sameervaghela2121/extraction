import { api } from "./client";

export interface UploadResult {
  jobId: string;
  documents: Array<{ id: string; title: string; status: string }>;
}

export const uploadsApi = {
  upload: (
    files: File[],
    onProgress?: (pct: number) => void,
    source?: "upload" | "scan",
    // "grn" keeps the resulting document out of the Documents list and Export.
    purpose?: "invoice" | "grn",
  ) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (source) form.append("source", source);
    if (purpose) form.append("purpose", purpose);
    return api
      .post<UploadResult>("/documents/upload", form, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then((r) => r.data);
  },
};
