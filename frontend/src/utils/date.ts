/**
 * DD-MM-YYYY for real timestamps (createdAt, decidedAt) on the GRN screens.
 *
 * Distinct from the backend's toDdMmYyyy, which *parses* the free-text invoice date Gemini
 * extracted. This one only *formats* an ISO string that is already a valid date.
 */
export function formatDdMmYyyy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}
