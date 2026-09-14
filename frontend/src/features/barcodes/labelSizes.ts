/**
 * Standard sticker sizes, one list per code type.
 *
 * These replace free-form width/height entry: the operator picks a roll size rather than
 * typing millimetres, so there's no way to end up with a size the printer wasn't loaded
 * with. Barcode sizes are wide rectangles — CODE128 reads left to right, so extra width
 * buys quiet-zone and font room, not scan reliability. QR sizes are square: a QR symbol
 * is read as a grid, and stretching it into a rectangle just wastes label on one axis
 * while starving the other.
 */

export type LabelKind = "barcode" | "qr";

export interface LabelSizeOption {
  /** Shown in the dropdown, e.g. "100 x 50 mm". */
  label: string;
  widthMm: number;
  heightMm: number;
}

export const BARCODE_SIZES: LabelSizeOption[] = [
  { label: "70 x 30 mm", widthMm: 70, heightMm: 30 },
  { label: "80 x 35 mm", widthMm: 80, heightMm: 35 },
  { label: "100 x 50 mm", widthMm: 100, heightMm: 50 },
];

/** Common square label stock for QR stickers — sized to roughly the same range as the
 *  barcode presets above, just square rather than wide. */
export const QR_SIZES: LabelSizeOption[] = [
  { label: "30 x 30 mm", widthMm: 30, heightMm: 30 },
  { label: "40 x 40 mm", widthMm: 40, heightMm: 40 },
  { label: "50 x 50 mm", widthMm: 50, heightMm: 50 },
];

export function sizesFor(kind: LabelKind): LabelSizeOption[] {
  return kind === "qr" ? QR_SIZES : BARCODE_SIZES;
}

export function defaultSizeFor(kind: LabelKind): LabelSizeOption {
  return sizesFor(kind)[kind === "qr" ? 1 : 2];
}

/** True if this width/height is one of the given kind's standard sizes — used to fall back
 *  to that kind's default rather than keep a size that belonged to the other kind. */
export function findSize(kind: LabelKind, widthMm: number, heightMm: number): LabelSizeOption | null {
  return sizesFor(kind).find((s) => s.widthMm === widthMm && s.heightMm === heightMm) ?? null;
}
