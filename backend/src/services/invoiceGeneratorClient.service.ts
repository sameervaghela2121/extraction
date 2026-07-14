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

let cachedToken: string | null = null;

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
