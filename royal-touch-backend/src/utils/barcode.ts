const BARCODE_PREFIX = "RT";
const BARCODE_DIGITS = 6;

/** RT-000123. Fixed width so the printed sticker stays the same size for years. */
export function formatBarcodeId(sequence: number): string {
  return `${BARCODE_PREFIX}-${String(sequence).padStart(BARCODE_DIGITS, "0")}`;
}

export const BARCODE_ID_PATTERN = new RegExp(`^${BARCODE_PREFIX}-\\d{${BARCODE_DIGITS},}$`);

/**
 * A Zebra label as ZPL, ready to send to the printer paired with the phone.
 *
 * ponytail: a template string, not a label-design library. The printer rasterises the
 * Code 128 itself from ^BC — there is no image to generate, and no dependency to add.
 * Coordinates are for a 4x2in / 100x50mm label at 203dpi; adjust ^FO/^BY if the stock
 * changes.
 */
export function buildZpl(params: {
  barcodeId: string;
  materialName: string;
  widthMm: number;
  gsm: number;
  weightKg: number;
}): string {
  // ZPL is field-delimited by ^; a caret inside a value would corrupt the label.
  const clean = (value: string) => value.replace(/[\^~]/g, " ").slice(0, 32);

  return [
    "^XA",
    "^CI28", // UTF-8, so a supplier name with an accent prints correctly
    `^FO30,30^A0N,36,36^FD${clean(params.materialName)}^FS`,
    `^FO30,80^A0N,28,28^FD${params.widthMm}mm  ${params.gsm}gsm  ${params.weightKg}kg^FS`,
    "^BY3,3,120",
    `^FO30,130^BCN,120,Y,N,N^FD${params.barcodeId}^FS`,
    "^XZ",
  ].join("\n");
}
