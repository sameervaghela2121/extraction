/**
 * Normalise an extracted invoice date to DD-MM-YYYY for the GRN screens.
 *
 * EXTRACTION_PROMPT (invoice-generator-backend/api/main.py) declares `invoice_date` as a bare
 * string, so Gemini returns whatever the invoice printed. Real values in the database:
 *   26/06/2026   12-06-2026   09-07-26   18-Jun-26   30 Jun 2026   30 June, 2026
 *
 * All of them are day-first — "13/05/2025" proves it, since 13 cannot be a month — so this
 * parses day-first without guessing.
 */

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** Numeric, or a month name of any length ("Jun" / "June") — matched on its first 3 letters. */
function toMonth(part: string): number | null {
  if (/^\d+$/.test(part)) {
    const n = Number(part);
    return n >= 1 && n <= 12 ? n : null;
  }
  const idx = MONTHS.indexOf(part.slice(0, 3).toLowerCase());
  return idx === -1 ? null : idx + 1;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDdMmYyyy(raw?: string | null): string {
  if (!raw) return "";
  const parts = raw.trim().split(/[\s,./-]+/).filter(Boolean);
  // Every bail-out below hands the raw string back untouched. A wrong date on a goods receipt
  // is worse than an ugly one, so an unrecognised shape is never guessed at or reordered.
  if (parts.length !== 3) return raw;

  const day = Number(parts[0]);
  const month = toMonth(parts[1]);
  let year = Number(parts[2]);

  if (!Number.isInteger(day) || day < 1 || day > 31) return raw;
  if (month === null) return raw;
  if (!Number.isInteger(year)) return raw;
  // Every 2-digit year seen in real data is 25/26.
  if (year < 100) year += 2000;

  return `${pad(day)}-${pad(month)}-${year}`;
}
