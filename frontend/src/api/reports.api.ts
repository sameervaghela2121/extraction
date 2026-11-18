import { AxiosError } from "axios";
import { api, call } from "./client";

// royal_touche/api/portal_reports.py: the old /reports routes, same query names and answers.
const M = "royal_touche.api.portal_reports.";

/** A material's figures over a period, in kg. */
export interface ConsumptionFigures {
  opening: number;
  received: number;
  consumed: number;
  returned_to_vendor: number;
  sold: number;
  adjusted: number;
  closing: number;
  out_at_close: number;
}
export type ConsumptionGroup = "material" | "design";
export interface ConsumptionRow extends ConsumptionFigures {
  material_code: string;
  material: string;
  /** Design rows only. */
  rt_code?: string;
  delta_code?: string;
  vendor?: string;
}
export interface ConsumptionSummary {
  from: string;
  to: string;
  group: ConsumptionGroup;
  rows: ConsumptionRow[];
  totals: ConsumptionFigures;
}

/** Requests a CSV and saves it in the same call; nothing is stored server-side. */
async function saveCsv(method: string, params: Record<string, string>, filename: string) {
  try {
    const res = await api.get<Blob>(`/method/${M}${method}`, { params, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    // Asked for as a blob, an error's JSON body arrives as one too; read back here so
    // apiErrorMessage finds the server's message.
    if (err instanceof AxiosError && err.response?.data instanceof Blob) {
      const text = await err.response.data.text();
      try {
        err.response.data = JSON.parse(text);
      } catch {
        // Not JSON (a proxy's HTML error page): no server message, so the status one shows.
        err.response.data = null;
      }
    }
    throw err;
  }
}

export const reportsApi = {
  /** How many rolls moved on an India-time day (YYYY-MM-DD). */
  dailyRollsCount: (date: string) =>
    call<{ count: number }>(`${M}daily_rolls_count`, { date }).then((r) => r.count),

  downloadDailyRolls: (date: string) =>
    saveCsv("daily_rolls", { date }, `daily-roll-report-${date}.csv`),

  consumption: (from: string, to: string, group: ConsumptionGroup) =>
    call<ConsumptionSummary>(`${M}consumption`, { from, to, group }),

  downloadConsumptionSummary: (from: string, to: string, group: ConsumptionGroup) =>
    saveCsv(
      "consumption_summary_csv",
      { from, to, group },
      `${group === "design" ? "consumption-by-design" : "consumption-summary"}-${from}-to-${to}.csv`,
    ),

  downloadConsumptionDetail: (from: string, to: string) =>
    saveCsv("consumption_detail_csv", { from, to }, `consumption-detail-${from}-to-${to}.csv`),
};
