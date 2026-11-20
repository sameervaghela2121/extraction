/** Shared number/date formatting for dashboard widgets. */

export const iso = (date: Date) => date.toLocaleDateString("en-CA");

/** Whole kilograms use grouping (82,700); fractional keep up to 3 dp. */
export const kg = (value: number) => {
  const whole = Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-9;
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: whole ? 0 : 3,
    minimumFractionDigits: 0,
  });
};

/** Number + unit for people reading the dashboard (e.g. "86,358 kg"). */
export const kgLabel = (value: number) => `${kg(value)} kg`;

/** Compact axis ticks so five- and six-digit kg stay readable. */
export const axisKg = (value: number) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 100_000) {
    return `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}k`;
  }
  return Math.round(n).toLocaleString("en-IN");
};

export const count = (value: number) => value.toLocaleString("en-IN");

/** Count with a plain unit word (e.g. "118 rolls"). */
export const countLabel = (value: number, unit: string) => `${count(value)} ${unit}`;

export const pct = (value: number, total: number) => {
  if (!total) return "0%";
  return `${Math.round((100 * value) / total)}%`;
};

export const shortDate = (yyyyMmDd: string) => {
  const d = new Date(`${yyyyMmDd}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export const weekdayShort = (yyyyMmDd: string) => {
  const d = new Date(`${yyyyMmDd}T12:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "short" });
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
