import axios from "axios";
import { api } from "./client";

export interface UploadResult {
  jobId: string;
  documents: Array<{ id: string; title: string; status: string }>;
}

export interface PresignedUpload {
  idx: number;
  filename: string;
  mimetype: string;
  objectPath: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

interface PresignResult {
  jobId: string;
  uploads: PresignedUpload[];
}

// A bare axios instance — no baseURL, no auth-token interceptor — for PUTting straight to a
// GCS signed URL. The shared `api` instance always injects our own Bearer token and prefixes
// requests with our own API base, both of which a pre-authorized signed URL rejects.
const rawPut = axios.create();

export const uploadsApi = {
  /** Step 1: ask Node for one signed PUT URL per file about to be uploaded. */
  presign: (files: File[]) =>
    api
      .post<PresignResult>("/documents/upload/presign", {
        files: files.map((f) => ({ filename: f.name, mimetype: f.type })),
      })
      .then((r) => r.data),

  /** Step 2: PUT one file's bytes straight to GCS via its signed URL. Real per-file progress,
   *  unlike the old single-request-for-everything upload. */
  putToStorage: (file: File, target: PresignedUpload, onProgress?: (pct: number) => void) =>
    rawPut.put(target.uploadUrl, file, {
      headers: target.headers,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    }),

  /** Step 3: tell Node every file landed in storage, so it can register the job and hand it
   *  to the extraction service. Node already knows which objects this jobId covers (it
   *  recorded that itself at presign time) — nothing storage-related is sent here. */
  confirm: (jobId: string, source: "upload" | "scan", purpose?: "invoice" | "grn" | "voucher") =>
    api
      .post<UploadResult>("/documents/upload/confirm", { jobId, source, purpose: purpose ?? "invoice" })
      .then((r) => r.data),

  /** Runs the full presign -> PUT -> confirm sequence for a batch of files uploaded together.
   *  `onProgress` reports the average percentage across every file's own PUT. */
  async upload(
    files: File[],
    onProgress?: (pct: number) => void,
    source: "upload" | "scan" = "upload",
    purpose?: "invoice" | "grn" | "voucher",
  ): Promise<UploadResult> {
    const { jobId, uploads } = await uploadsApi.presign(files);
    const progress = new Array(files.length).fill(0);
    const report = () => {
      if (!onProgress) return;
      onProgress(Math.round(progress.reduce((a, b) => a + b, 0) / progress.length));
    };
    await Promise.all(
      uploads.map((target, i) =>
        uploadsApi.putToStorage(files[i], target, (pct) => {
          progress[i] = pct;
          report();
        }),
      ),
    );
    return uploadsApi.confirm(jobId, source, purpose);
  },
};
