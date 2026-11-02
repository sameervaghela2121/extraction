import type { LotDocumentType } from "../../types";

/** "Challan" / "Invoice" — how a lot's document type reads on screen. */
export function documentTypeLabel(type: LotDocumentType | null | undefined): string {
  return type === "invoice" ? "Invoice" : "Challan";
}
