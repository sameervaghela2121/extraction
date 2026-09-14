/**
 * Margins and bar height for a label, as a function of its physical size.
 *
 * The PDF and ZPL renderers used to hardcode these at fixed millimetre values for the one
 * label size the app supported (100 x 50mm). Now that the sticker size is a setting, both
 * need the same physical margins and bar height for any size — otherwise the same batch
 * would lay out differently depending which file you downloaded.
 *
 * The formulas below are tuned so that at exactly 100 x 50mm they reproduce the original
 * fixed values (4mm margins, 24mm bars), and scale down for a smaller roll rather than
 * running text or bars off the edge of it.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface LabelLayoutMm {
  sideMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
  barHeightMm: number;
}

export function computeLabelLayoutMm(widthMm: number, heightMm: number): LabelLayoutMm {
  return {
    sideMarginMm: clamp(widthMm * 0.04, 1.5, 4),
    topMarginMm: clamp(heightMm * 0.08, 1.5, 4),
    bottomMarginMm: clamp(heightMm * 0.08, 1.5, 4),
    barHeightMm: clamp(heightMm * 0.48, 6, 24),
  };
}

export interface QrLabelLayoutMm {
  sideMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
  /** Edge length of the QR square — unlike barHeightMm, this also has to fit within the
   *  label's width, since a QR (unlike a barcode) is square rather than free to run wall
   *  to wall. */
  qrSideMm: number;
}

/**
 * Margins and QR size for a label, mirroring computeLabelLayoutMm above.
 *
 * A QR code is read as a 2D grid rather than left-to-right bars, so it wants to be as large
 * as the label allows on both axes — not just tall, like a barcode's bars. It's sized to
 * the smaller of the label's usable width and height, so it's never cropped, and clamped to
 * leave room below it for the plain-text code and detail lines the label still prints.
 */
export function computeQrLabelLayoutMm(widthMm: number, heightMm: number): QrLabelLayoutMm {
  const sideMarginMm = clamp(widthMm * 0.04, 1.5, 4);
  const topMarginMm = clamp(heightMm * 0.06, 1.5, 4);
  const bottomMarginMm = clamp(heightMm * 0.06, 1.5, 4);
  const usableWidthMm = widthMm - sideMarginMm * 2;
  // Reserve ~40% of the label height for the code text and detail lines below the QR,
  // same proportions as a barcode's font sizing in pdf.ts/zpl.ts.
  const usableHeightMm = heightMm - topMarginMm - bottomMarginMm * 0.4 - heightMm * 0.28;
  return {
    sideMarginMm,
    topMarginMm,
    bottomMarginMm,
    qrSideMm: clamp(Math.min(usableWidthMm, usableHeightMm), 10, 60),
  };
}
