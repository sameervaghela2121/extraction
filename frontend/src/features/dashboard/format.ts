/** Shared number/date formatting for dashboard widgets. */

export const iso = (date: Date) => date.toLocaleDateString("en-CA");

export const kg = (value: number) =>
  value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export const count = (value: number) => value.toLocaleString("en-IN");

export const shortDate = (yyyyMmDd: string) => {
  const d = new Date(`${yyyyMmDd}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export type Period = "day" | "week" | "month";

export function rangeOf(period: Period, picked: string): { from: string; to: string } {
  const day = new Date(`${picked}T12:00:00`);
  if (period === "day") return { from: picked, to: picked };
  if (period === "week") {
    const sinceMonday = (day.getDay() + 6) % 7;
    const monday = new Date(day);
    monday.setDate(day.getDate() - sinceMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: iso(monday), to: iso(sunday) };
  }
  return {
    from: iso(new Date(day.getFullYear(), day.getMonth(), 1, 12)),
    to: iso(new Date(day.getFullYear(), day.getMonth() + 1, 0, 12)),
  };
}

export const STATUS_LABELS: Record<string, string> = {
  IN_STOCK: "In stock",
  ISSUED: "Out on floor",
  CONSUMED: "Consumed",
  RETURNED_TO_VENDOR: "Returned to vendor",
  SOLD: "Sold",
};

export const STATUS_COLORS: Record<string, string> = {
  IN_STOCK: "#006e2f",
  ISSUED: "#ba1a1a",
  CONSUMED: "#6b7280",
  RETURNED_TO_VENDOR: "#b45309",
  SOLD: "#003d9b",
};

export const MOVEMENT_COLORS: Record<string, string> = {
  Received: "#003d9b",
  Consumed: "#6b7280",
  Sold: "#0052cc",
  "Returned to vendor": "#b45309",
  Adjusted: "#0e7490",
};
