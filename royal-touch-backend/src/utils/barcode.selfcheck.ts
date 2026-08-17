/** `npx tsx src/utils/barcode.selfcheck.ts` — no DB, no server needed. */
import { formatBarcodeId, buildZpl, BARCODE_ID_PATTERN } from "./barcode";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfCheck failed: ${msg}`);
}

assert(formatBarcodeId(1) === "RT-000001", "first roll");
assert(formatBarcodeId(123) === "RT-000123", "padded to six digits");
// Past a million rolls the id grows rather than wrapping — a repeated barcode would mean
// two physical rolls sharing one identity.
assert(formatBarcodeId(1000000) === "RT-1000000", "no wraparound past six digits");
assert(BARCODE_ID_PATTERN.test("RT-000123"), "pattern accepts a real id");
assert(!BARCODE_ID_PATTERN.test("RT-12"), "pattern rejects a short id");
assert(!BARCODE_ID_PATTERN.test("XX-000123"), "pattern rejects a foreign prefix");

const zpl = buildZpl({
  barcodeId: "RT-000123",
  materialName: "Lamella",
  widthMm: 1250,
  gsm: 70,
  weightKg: 247,
});
assert(zpl.startsWith("^XA") && zpl.trimEnd().endsWith("^XZ"), "well-formed ZPL envelope");
assert(zpl.includes("^FDRT-000123^FS"), "barcode data field present");
assert(zpl.includes("1250mm  70gsm  247kg"), "human-readable line present");

// A caret in a material name would end the field early and corrupt the label.
const hostile = buildZpl({
  barcodeId: "RT-000124",
  materialName: "Oak^FS^XZ",
  widthMm: 1250,
  gsm: 70,
  weightKg: 100,
});
assert(!hostile.includes("Oak^FS^XZ"), "control characters stripped from text");
assert(hostile.trimEnd().endsWith("^XZ"), "envelope still closes exactly once");

console.log("barcode selfCheck OK");
