import type { VendorPaper } from "../../types";

type WithPapers = { royal_touche_code?: string; papers?: VendorPaper[] };

/** Every distinct value of one paper field across a roll's papers, comma-joined, or "—". */
function codes(roll: WithPapers, field: "royal_touche_code" | "delta_code" | "supplier_code_number") {
  const values = [...new Set((roll.papers ?? []).map((p) => p[field]).filter(Boolean))];
  return values.length ? values.join(", ") : "";
}

/** RT code(s). Falls back to the roll's own royal_touche_code for a roll with no papers. */
export const rtCodes = (roll: WithPapers) => codes(roll, "royal_touche_code") || roll.royal_touche_code || "—";
export const deltaCodes = (roll: WithPapers) => codes(roll, "delta_code") || "—";
export const supplierCodes = (roll: WithPapers) => codes(roll, "supplier_code_number") || "—";
