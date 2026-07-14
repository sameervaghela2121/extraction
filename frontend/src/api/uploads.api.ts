import { api } from "./client";

export interface UploadResult {
  jobId: string;
  documents: Array<{ id: string; title: string; status: string }>;
}

export const uploadsApi = {
  upload: (files: File[], onProgress?: (pct: number) => void) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return api
      .post<UploadResult>("/documents/upload", form, {
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then((r) => r.data);
  },
  createScanSession: () =>
    api
      .post<{ token: string; expiresAt: string; scanUrl: string }>("/scan-sessions")
      .then((r) => r.data),
  inboundEmailAddress: () =>
    api.get<{ address: string }>("/inbound-email-address").then((r) => r.data),
};
