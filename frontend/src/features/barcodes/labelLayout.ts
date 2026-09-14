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
