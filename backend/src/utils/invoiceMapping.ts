import type { ISharedInvoice } from "../models/SharedInvoice.model";

export type Confidence = "high" | "needs_attention";

/**
 * Confidence mapping (per plan's open item, current default):
 *  validation === "OK"  -> "high"
 *  anything else / missing -> "needs_attention"
 * The Python service has no per-field confidence; `validation` is its only quality signal.
 */
export function confidenceFromValidation(validation?: string): Confidence {
  return validation && validation.trim().toUpperCase() === "OK" ? "high" : "needs_attention";
}

/** Fixed, non-field keys that should never be surfaced as editable "extracted fields". */
const NON_FIELD_KEYS = new Set([
  "_id",
  "job_id",
  "file_id",
  "created_at",
  "validation",
  "error",
  "editedBy",
  "editedAt",
  "job_cost_usd",
  "job_cost_inr",
  "job_tokens",
  "other_fields",
  "items",
  "page",
]);

/** The invoice-level scalar amount used for the Documents list "Amount" column. */
export function invoiceAmount(inv?: ISharedInvoice | null): number | null {
  return inv?.grand_total ?? null;
}

/** The vendor/seller shown as the human title fallback. */
export function invoiceVendor(inv?: ISharedInvoice | null): string | null {
  return inv?.seller_name ?? null;
}

export interface ExtractedField {
  key: string;
  value: string | number | null;
  isCustom: boolean;
}

/**
 * Flatten a shared Invoice document into a list of extracted fields for the Detail view.
 * Built-in scalar fields first, then any ad-hoc keys the model put in `other_fields`.
 */
export function extractedFields(inv?: ISharedInvoice | null): ExtractedField[] {
  if (!inv) return [];
  const record = inv as unknown as Record<string, unknown>;
  const out: ExtractedField[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (NON_FIELD_KEYS.has(key)) continue;
    if (typeof value === "object" && value !== null) continue;
    out.push({ key, value: (value as string | number | null) ?? null, isCustom: false });
  }

  const other = inv.other_fields ?? {};
  for (const [key, value] of Object.entries(other)) {
    out.push({ key, value: value ?? null, isCustom: true });
  }

  return out;
}

/** Line items are tabular (qty/rate/amount per row), unlike the scalar fields above —
 * kept separate so the Detail page can render them as a table instead of input rows.
 * `items` is `Schema.Types.Mixed`: different PDFs can extract different item shapes,
 * so this stays a loose record rather than a fixed interface — the caller derives
 * columns from whatever keys actually show up instead of assuming one schema. */
export function extractedItems(inv?: ISharedInvoice | null): Array<Record<string, unknown>> {
  return (inv?.items as unknown as Array<Record<string, unknown>>) ?? [];
}
