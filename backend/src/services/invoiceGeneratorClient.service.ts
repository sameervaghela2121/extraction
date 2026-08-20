import axios, { AxiosError, type AxiosInstance } from "axios";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ApiError } from "../utils/ApiError";

/**
 * Server-to-server client for the existing Python FastAPI `invoice-generator-backend`.
 * Responsibilities:
 *  - hold a cached service-account bearer token (obtained via its POST /login), re-logging in on 401
 *  - forward uploaded files to POST /extract (returns { job_id })
 *  - stream original file bytes from GET /files/{fid}/raw for document preview
 *
 * Extraction results themselves are NOT fetched here — they are read directly out of the
 * shared MongoDB (Files / Invoice collections) by the documents module.
 */

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface CustomFieldPromptInput {
  key: string;
  label: string;
  description?: string;
}

export interface StorageFileRef {
  _id: string;
  idx: number;
  filename: string;
  mime: string;
  path: string;
}

let cachedToken: string | null = null;

// CPU-only inference is slow and varies with the host: ~11s on a dev laptop, 52s on a
// 2-vCPU Cloud Run instance. The timeout has to clear the slow case, or a successful read
// gets thrown away and the caller sees a failure the logs say never happened.
const OCR_TIMEOUT_MS = 120_000;

/** One recognised word with its box, as api/roll_label_ocr.py returns it. */
type RollLabelWord = { text: string; x: number; y: number; w: number; h: number; conf: number };

const http: AxiosInstance = axios.create({
  baseURL: env.invoiceGeneratorBaseUrl,
  timeout: 120_000,
});

async function login(): Promise<string> {
  try {
    const { data } = await http.post<{ token: string }>("/login", {
      email: env.invoiceGeneratorAppUser,
      password: env.invoiceGeneratorAppPassword,
    });
    cachedToken = data.token;
    return data.token;
  } catch (err) {
    logger.error("[invoiceGenerator] login failed", (err as AxiosError).message);
    throw new ApiError(502, "Could not authenticate with the extraction service");
  }
}

async function getToken(): Promise<string> {
  return cachedToken ?? (await login());
}

/** Runs a request with the cached token; on 401 it re-logs in once and retries. */
async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getToken();
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 401) {
      const fresh = await login();
      return fn(fresh);
    }
    throw err;
  }
}

export const invoiceGeneratorClient = {
  /**
   * Forward one or more files to /extract. Returns the job_id; the Python service registers
   * a `Files` doc (status "processing") per file under that job_id immediately.
   */
  async extract(files: UploadedFile[], customFields?: CustomFieldPromptInput[]): Promise<{ jobId: string }> {
    return withAuth(async (token) => {
      const form = new FormData();
      for (const f of files) {
        const blob = new Blob([new Uint8Array(f.buffer)], { type: f.mimetype });
        form.append("files", blob, f.originalname);
      }
      if (customFields && customFields.length > 0) {
        form.append("custom_fields", JSON.stringify(customFields));
      }
      try {
        const { data } = await http.post<{ job_id: string }>("/extract", form, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return { jobId: data.job_id };
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 401) throw err; // handled by withAuth
        logger.error("[invoiceGenerator] extract failed", (err as AxiosError).message);
        throw new ApiError(502, "The extraction service rejected the upload");
      }
    });
  },

  /**
   * Tell the extraction service to analyze files it hasn't seen bytes for yet — they were
   * uploaded straight to GCS by the browser via a Node-issued signed URL. The service downloads
   * them itself, runs the same preprocessing/Gemini pipeline as `/extract`, and returns fast
   * (the actual analysis runs in its own background task, same as today).
   */
  async analyzeFromStorage(
    jobId: string,
    files: StorageFileRef[],
    source: "upload" | "scan",
    customFields?: CustomFieldPromptInput[],
  ): Promise<void> {
    return withAuth(async (token) => {
      try {
        await http.post(
          "/extract/from-storage",
          { job_id: jobId, source, files, custom_fields: customFields ?? [] },
          { headers: { Authorization: `Bearer ${token}` } },
        );
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 401) throw err; // handled by withAuth
        logger.error("[invoiceGenerator] analyzeFromStorage failed", (err as AxiosError).message);
        throw new ApiError(502, "The extraction service rejected the job");
      }
    });
  },

  /**
   * Read a roll label photo with the service's local OCR (api/roll_label_ocr.py).
   * Returns the raw text lines and mean confidence — the field parsing stays on this
   * side, in ocr.service, so all three engines share one parser.
   */
  async readRollLabel(
    image: Buffer,
    filename = "label.jpg",
  ): Promise<{ lines: string[]; confidence: number; words?: RollLabelWord[] }> {
    return withAuth(async (token) => {
      const form = new FormData();
      form.append("photo", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), filename);
      try {
        const { data } = await http.post<{
          lines: string[];
          confidence: number;
          words?: RollLabelWord[];
        }>(
          "/ocr/roll-label",
          form,
          { headers: { Authorization: `Bearer ${token}` }, timeout: OCR_TIMEOUT_MS },
        );
        return data;
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 401) throw err; // handled by withAuth
        logger.error("[invoiceGenerator] roll-label OCR failed", (err as AxiosError).message);
        throw new ApiError(502, "The label could not be read by the extraction service");
      }
    });
  },

  /** Stream the original uploaded file bytes for preview. */
  async getRawFile(fileId: string): Promise<{ stream: NodeJS.ReadableStream; contentType: string }> {
    return withAuth(async (token) => {
      const res = await http.get(`/files/${fileId}/raw`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "stream",
      });
      return {
        stream: res.data as NodeJS.ReadableStream,
        contentType: (res.headers["content-type"] as string) ?? "application/octet-stream",
      };
    });
  },
};
