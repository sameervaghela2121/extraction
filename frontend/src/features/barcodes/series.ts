import type { LabelItem } from "./Label";

/** One print run's worth. Guards against a typo like 1-100000 rendering a canvas per
 *  label and locking the tab up. */
export const MAX_SERIES = 500;

/** Roll numbers already read as RT + YYMMDD + number, so a generated series matches them. */
const MIN_DIGITS = 3;

export interface SeriesInput {
  /** Letters before the number, e.g. "RT". */
  prefix: string;
  /** The day the labels are for, as YYYY-MM-DD (what <input type="date"> gives). Blank = none. */
  date: string;
  from: number;
  to: number;
}

export type SeriesResult =
  | { ok: true; labels: LabelItem[] }
  | { ok: false; error: string };

/** "2026-09-07" → "260907", the form the roll numbers use. */
export function dateDigits(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1].slice(2)}${match[2]}${match[3]}` : "";
}

/** The code a given number in the run produces. Exported so the form can show the client
 *  exactly what they'll get before they commit to a few hundred labels. */
export function seriesCode(input: SeriesInput, n: number): string {
  const width = Math.max(MIN_DIGITS, String(Math.max(input.to, input.from)).length);
  return `${input.prefix.trim()}${dateDigits(input.date)}${String(n).padStart(width, "0")}`;
}

/** Expand the form into labels. Kept out of the component so the rules — the only real
 *  logic on this screen — can be read and checked on their own. */
export function buildSeries(input: SeriesInput): SeriesResult {
  const { from, to } = input;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
    return { ok: false, error: "Start and end must be whole numbers." };
  }
  if (to < from) return { ok: false, error: "The end number is lower than the start number." };

  const count = to - from + 1;
  if (count > MAX_SERIES) {
    return { ok: false, error: `That's ${count} labels — ${MAX_SERIES} at a time is the limit.` };
  }

  const labels: LabelItem[] = [];
  for (let n = from; n <= to; n++) {
    const code = seriesCode(input, n);
    labels.push({ key: `series:${code}`, code, lines: [] });
  }
  return { ok: true, labels };
}
