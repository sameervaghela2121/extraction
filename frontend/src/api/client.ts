import axios, { AxiosError } from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

const ACCESS_KEY = "docflow.accessToken";
const REFRESH_KEY = "docflow.refreshToken";

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

// On 401, try one refresh; if that fails, clear tokens and bounce to login.
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config;
    if (
      error.response?.status === 401 &&
      original &&
      !original.url?.includes("/auth/") &&
      !(original as { _retried?: boolean })._retried
    ) {
      (original as { _retried?: boolean })._retried = true;
      try {
        if (!refreshing) {
          const refreshToken = tokenStore.refresh;
          if (!refreshToken) throw new Error("no refresh token");
          refreshing = axios
            .post(`${BASE_URL}/auth/refresh`, { refreshToken })
            .then((r) => {
              tokenStore.set(r.data.accessToken, r.data.refreshToken);
              return r.data.accessToken as string;
            })
            .finally(() => {
              refreshing = null;
            });
        }
        const newToken = await refreshing;
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        tokenStore.clear();
        if (!location.pathname.startsWith("/login")) location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof AxiosError) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? err.message ?? fallback;
  }
  return fallback;
}
