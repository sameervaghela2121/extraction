import { call } from "./client";

export const appApi = {
  /** Where the current Android build downloads from — asked fresh on every click rather than
   *  cached, so a new build is picked up without reloading the page. */
  apkDownloadUrl: () =>
    call<{ url: string }>("royal_touche.api.portal_lots.apk_url").then((r) => r.url),
};
