import axios, { AxiosError } from "axios";

// The ERPNext backend: its own methods at /api/method/<dotted.path>, standard records at
// /api/resource/<DocType>. `npm run dev:erp` forwards /api to it (see vite.config.ts).
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const ACCESS_KEY = "docflow.accessToken";
const REFRESH_KEY = "docflow.refreshToken";
const AUTH_METHODS = "royal_touche.api.auth.";

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, try one refresh. Only the server refusing it ends the session: a dropped connection
// or a busy server leaves the login as it was, and this request simply fails.
let refreshing: Promise<string> | null = null;
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config;
    if (
      error.response?.status === 401 &&
      original &&
      !original.url?.includes(AUTH_METHODS) &&
      !(original as { _retried?: boolean })._retried
    ) {
      (original as { _retried?: boolean })._retried = true;
      try {
        if (!refreshing) {
          const refreshToken = tokenStore.refresh;
          if (!refreshToken) throw new AxiosError("no refresh token", undefined, undefined, undefined, {
            status: 401,
          } as never);
          refreshing = axios
            .post(`${BASE_URL}/method/${AUTH_METHODS}refresh`, { refresh_token: refreshToken })
            .then((r) => {
              const m = r.data.message as { access_token: string; refresh_token: string };
              tokenStore.set(m.access_token, m.refresh_token);
              return m.access_token;
            })
            .finally(() => {
              refreshing = null;
            });
        }
        const newToken = await refreshing;
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        if ((refreshError as AxiosError).response?.status === 401) {
          tokenStore.clear();
          if (!location.pathname.startsWith("/login")) location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Calls one of the backend's whitelisted methods (royal_touche.api.*) and returns its
 * `message`, the method's return value. GET sends [args] as query parameters, anything else
 * as a JSON body.
 */
export async function call<T>(
  method: string,
  args: Record<string, unknown> = {},
  httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "GET",
): Promise<T> {
  const url = `/method/${method}`;
  const params = Object.fromEntries(
    Object.entries(args)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]),
  );
  const res =
    httpMethod === "GET"
      ? await api.get(url, { params })
      : await api.request({ url, method: httpMethod, data: args });
  return res.data.message as T;
}

/** Uploads one file to ERPNext as a private file; returns its path ("/private/files/x.jpg"). */
export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("is_private", "1");
  const res = await api.post("/method/upload_file", form);
  return (res.data.message as { file_url: string }).file_url;
}

/** The address the browser loads a stored file from (same origin as the API). */
export function fileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const origin = BASE_URL.replace(/\/api\/?$/, "");
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Plain text without ERPNext's HTML (<strong>, links). */
export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** The human message in an ERPNext error reply: `_server_messages` (a JSON list of JSON
 *  objects), else `exception` ("module.Class: text"), else `message` / the old `error`. */
export function frappeErrorText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d._server_messages === "string") {
    try {
      const list = JSON.parse(d._server_messages) as string[];
      const texts = list
        .map((item) => {
          try {
            return (JSON.parse(item) as { message?: string }).message ?? item;
          } catch {
            return item;
          }
        })
        .filter(Boolean);
      if (texts.length) return stripHtml(texts.join("\n"));
    } catch {
      /* fall through */
    }
  }
  if (typeof d.exception === "string" && d.exception) {
    const text = d.exception.includes(": ") ? d.exception.slice(d.exception.indexOf(": ") + 2) : d.exception;
    return stripHtml(text.split("\n")[0]);
  }
  for (const key of ["error", "message"]) {
    if (typeof d[key] === "string" && (d[key] as string).trim()) return stripHtml(d[key] as string);
  }
  return null;
}

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? 0;
    // A server failure's body is a traceback, never something to show.
    if (status >= 500) return "Server error. Please try again.";
    return frappeErrorText(err.response?.data) ?? err.message ?? fallback;
  }
  return fallback;
}
