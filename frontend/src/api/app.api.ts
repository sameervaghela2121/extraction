import { api } from "./client";

export const appApi = {
  /** A signed, short-lived GCS URL for the current Android build — mint fresh on every
   *  click and navigate to it directly, rather than caching one: it expires in minutes,
   *  and the whole point of signing it per-request is that there's nothing to invalidate
   *  when a new build overwrites the object it points at. */
  apkDownloadUrl: () => api.get<{ url: string }>("/app/apk").then((r) => r.data.url),
};
