/**
 * GRN dates, normalised to DD-MM-YYYY.
 *
 * Invoice dates arrive as free text: EXTRACTION_PROMPT in
 * invoice-generator-backend/api/main.py tells the model to transcribe exactly what is printed
 * and NOT to reformat, so the live data holds at least a dozen shapes —
 *   04/06/2026 · 24-Apr-26 · 19-JUN-26 · 19-06-2026 · 09-07-26 · 2026-05-08
 *   30 Jun 2026 · April 2, 2026 · 30 June, 2026 · 03/06/2026 06:24 PM
 *
 * Used only by the GRN screens. Documents and Export keep their own formatting.
 */

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** "26" -> 2026, "84" -> 1984. Same window POSIX and Excel use. */
function expandYear(n: number, digits: number): number {
  if (digits > 2) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

function format(day: number, month: number, year: number, fallback: string): string {
  // Out-of-range means we misread the string — hand back the original rather than invent a date.
  if (month < 1 || month > 12 || day < 1 || day > 31) return fallback;
  return `${pad(day)}-${pad(month)}-${year}`;
}

/**
 * Anything -> "DD-MM-YYYY". Empty input gives "". **An unparseable string is returned
 * unchanged** — a date we can't read is still evidence of what the invoice said, so it must
 * never be blanked out or rendered as "Invalid Date".
 */
export function toDDMMYYYY(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()}`;
  }

  const raw = String(value).trim();
  if (!raw) return "";

  // "03/06/2026 06:24 PM" -> "03/06/2026"
  const dateOnly = raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\s*$/i, "").trim();
  const tokens = dateOnly.split(/[/\-,.\s]+/).filter(Boolean);
  if (tokens.length !== 3) return raw;

  // A named month makes the other two unambiguous: the 4-digit (or larger) one is the year.
  const monthIdx = tokens.findIndex((t) => MONTHS.indexOf(t.slice(0, 3).toLowerCase()) >= 0);
  if (monthIdx >= 0) {
    const month = MONTHS.indexOf(tokens[monthIdx].slice(0, 3).toLowerCase()) + 1;
    const rest = tokens.filter((_, i) => i !== monthIdx);
    if (rest.some((t) => !/^\d+$/.test(t))) return raw;

    const yearTokenIdx = rest[0].length === 4 ? 0 : rest[1].length === 4 ? 1 : Number(rest[0]) > 31 ? 0 : 1;
    const year = expandYear(Number(rest[yearTokenIdx]), rest[yearTokenIdx].length);
    const day = Number(rest[1 - yearTokenIdx]);
    return format(day, month, year, raw);
  }

  if (tokens.some((t) => !/^\d+$/.test(t))) return raw;
  const [a, b, c] = tokens.map(Number);

  // ISO, year first: 2026-05-08
  if (tokens[0].length === 4) return format(c, b, a, raw);

  const year = expandYear(c, tokens[2].length);
  // Prefer what the numbers prove; fall back to day-first, which is how Indian GST invoices
  // (what this system processes) are written.
  if (a > 12) return format(a, b, year, raw);
  if (b > 12) return format(b, a, year, raw);
  return format(a, b, year, raw);
}

// --- self-check: `npx tsx src/utils/grnDate.ts` ------------------------------
// Same approach as the assert block at the bottom of invoice-generator-backend/api/main.py.
// Every input below is a real value taken from the live Invoice collection.
if (require.main === module) {
  const assert = require("node:assert") as typeof import("node:assert");
  const eq = (input: unknown, expected: string) =>
    assert.strictEqual(toDDMMYYYY(input), expected, `${JSON.stringify(input)} -> ${toDDMMYYYY(input)}, wanted ${expected}`);

  // numeric, day-first
  eq("04/06/2026", "04-06-2026");
  eq("26/06/2026", "26-06-2026");
  eq("19-06-2026", "19-06-2026");
  eq("09-07-26", "09-07-2026");
  eq("13/05/2025", "13-05-2025");
  // second number > 12 proves month-first
  eq("06/24/2026", "24-06-2026");
  // ISO
  eq("2026-05-08", "08-05-2026");
  // named month, every casing and layout seen in the data
  eq("24-Apr-26", "24-04-2026");
  eq("19-JUN-26", "19-06-2026");
  eq("20-Jun-2026", "20-06-2026");
  eq("8-May-26", "08-05-2026");
  eq("30 Jun 2026", "30-06-2026");
  eq("06 Apr 2026", "06-04-2026");
  eq("30 June, 2026", "30-06-2026");
  eq("April 2, 2026", "02-04-2026");
  // trailing time is stripped
  eq("03/06/2026 06:24 PM", "03-06-2026");
  // real Date
  eq(new Date(2026, 6, 27), "27-07-2026");
  // empty
  eq("", "");
  eq(null, "");
  eq(undefined, "");
  // unparseable input survives untouched — never blanked, never "Invalid Date"
  eq("as per challan", "as per challan");
  eq("32/13/2026", "32/13/2026");
  eq("2026", "2026");

  console.log("grnDate self-check passed");
}
