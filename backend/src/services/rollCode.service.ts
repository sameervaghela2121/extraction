import { Counter } from "../models/Counter.model";

/**
 * Royal Touche roll code — minted by us, from the vendor's code.
 *
 * ASSUMED FORMAT, confirm with Royal Touche before go-live: "<VENDOR_CODE>-0001", with
 * the number restarting at 1 for each vendor. Both decisions are the two constants
 * below plus `formatRollCode` — change them here and nowhere else.
 */
const SEQUENCE_PAD = 4;
const SEPARATOR = "-";

function formatRollCode(vendorCode: string, seq: number): string {
  return `${vendorCode}${SEPARATOR}${String(seq).padStart(SEQUENCE_PAD, "0")}`;
}

/**
 * Reserve the next code for a vendor.
 *
 * findOneAndUpdate with $inc is a single atomic operation on one document, so two
 * concurrent registrations get 1 and 2 — never 1 and 1. The number is consumed whether
 * or not the roll goes on to save, which is the right trade: a gap in the sequence is
 * harmless, a duplicate code is not.
 */
export async function nextRollCode(vendorCode: string): Promise<string> {
  const counter = await Counter.findByIdAndUpdate(
    `roll_code:${vendorCode}`,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();

  return formatRollCode(vendorCode, counter!.seq);
}

// Exported for the self-check below and for tests. Not part of the create flow.
export const __testing = { formatRollCode };
