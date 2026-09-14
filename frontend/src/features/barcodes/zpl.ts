import { barPattern, type LabelItem } from "./Label";
import { clamp, computeLabelLayoutMm, computeQrLabelLayoutMm } from "./labelLayout";
import { qrModules } from "./qr";
import type { LabelKind } from "./labelSizes";

/**
 * ZPL — the language thermal label printers speak.
 *
 * Nothing is rendered here. A PDF has to draw every bar as a rectangle at a coordinate we
 * compute; ZPL just says "put a CODE128 of this text at this spot" and the printer draws it
 * at its own exact dot pitch. That is why a thermal printer's output is dimensionally
 * perfect where a PDF's depends on the print dialog not scaling anything.
 *
 * Zebra invented ZPL, but TSC and Honeywell printers read it too (TSC calls this mode
 * "TSPL-EZD" auto-emulation), so this is not a commitment to one brand.
 */

/** 203 dpi (8 dots/mm) is the standard resolution for this class of printer — but not the
 *  only one on the market: a 300 dpi model (12 dots/mm) needs every dot count below scaled
 *  up, or the same bar/margin/font would come out physically smaller on it. Everything here
 *  is computed from the requested resolution rather than assuming one. */
const DEFAULT_DOTS_PER_MM = 8;

/** 0.5mm is the narrow-bar width regardless of resolution; only the dot count needed to
 *  reach it changes. Whole dots on purpose: a fractional module makes the printer round
 *  some bars up and some down, and inconsistent bars are what a scanner reads as a bad
 *  symbol. */
const MODULE_MM = 0.5;

/**
 * ZPL's own escaping.
 *
 * `^` and `~` start commands, so a literal one inside field data would be executed. Our
 * codes are alphanumeric and never contain them, but the detail line is free text and a
 * stray caret would silently corrupt the label rather than print.
 */
function zplText(value: string): string {
  return value.replace(/[\^~]/g, " ");
}

/**
 * One barcode label, sized to the physical sticker in `widthMm` x `heightMm`, at the given
 * printer resolution.
 *
 * The barcode is centred by measuring it first: ZPL places a barcode from its top-left and
 * has no notion of centring one, so the module count comes from the same encoder the
 * preview and the PDF use, and the origin is worked out from that.
 */
function barcodeLabelZpl(item: LabelItem, widthMm: number, heightMm: number, dotsPerMm: number): string {
  const mm = (value: number) => Math.round(value * dotsPerMm);
  const module = mm(MODULE_MM);

  const layout = computeLabelLayoutMm(widthMm, heightMm);
  const labelW = mm(widthMm);
  const labelH = mm(heightMm);
  const topMargin = mm(layout.topMarginMm);
  const barHeight = mm(layout.barHeightMm);
  // Tuned to reproduce the original fixed 34/22 dots at 203dpi on the original 100x50mm
  // label — ZPL's built-in font takes a dot height, not a point size, so it scales with
  // resolution the same way the bars and margins do.
  const codeFont = Math.round(clamp(heightMm * 0.68, 14, 34) * (dotsPerMm / DEFAULT_DOTS_PER_MM));
  const detailFont = Math.round(clamp(heightMm * 0.44, 10, 22) * (dotsPerMm / DEFAULT_DOTS_PER_MM));

  const modules = barPattern(item.code).length;
  const barsWidth = modules * module;
  const x = Math.max(0, Math.round((labelW - barsWidth) / 2));

  const lines = [
    "^XA",
    // Stated on every label rather than left to the printer's saved defaults — a printer
    // configured for someone else's label size would otherwise silently crop ours.
    `^PW${labelW}`,
    `^LL${labelH}`,
    "^LH0,0",
    // UTF-8, so a separator like the middle dot prints as itself, not a mojibake byte.
    "^CI28",
    `^BY${module},2.5,${barHeight}`,
    `^FO${x},${topMargin}`,
    // CODE128, normal orientation, interpretation line printed BELOW the bars by the
    // printer — it centres that under the symbol for us, and it cannot drift out of step
    // with the bars the way separately-placed text could.
    `^BCN,${barHeight},Y,N,N`,
    `^FD${zplText(item.code)}^FS`,
  ];

  // Anything else sits under the interpretation line, centred across the full label width.
  let y = topMargin + barHeight + codeFont + mm(3);
  for (const line of item.lines) {
    if (y + detailFont > labelH) break;
    lines.push(
      `^FO0,${y}`,
      `^A0N,${detailFont},${detailFont}`,
      // Field block across the label: width, one line, no extra leading, centred.
      `^FB${labelW},1,0,C`,
      `^FD${zplText(line)}^FS`,
    );
    y += detailFont + mm(1.5);
  }

  lines.push("^XZ");
  return lines.join("\n");
}

/**
 * One QR label, mirroring barcodeLabelZpl above.
 *
 * Unlike the barcode path, the printer's own `^BQ` command draws the QR — we tell it the
 * data and a magnification factor rather than drawing modules ourselves (that's what pdf.ts
 * does instead, since a PDF has no such built-in command). The module count is known ahead
 * of time via qrModules(), the same encoder the preview and PDF use, so the magnification
 * can be chosen to hit the requested physical size rather than guessed. `^BQ`'s magnification
 * only goes up to 10, so a QR requesting a very large module size on a low-resolution
 * printer prints smaller than asked rather than distorted — the alternative, stretching it,
 * would break the square modules a scanner depends on.
 */
function qrLabelZpl(item: LabelItem, widthMm: number, heightMm: number, dotsPerMm: number): string {
  const mm = (value: number) => Math.round(value * dotsPerMm);

  const layout = computeQrLabelLayoutMm(widthMm, heightMm);
  const labelW = mm(widthMm);
  const labelH = mm(heightMm);
  const topMargin = mm(layout.topMarginMm);
  const qrSide = mm(layout.qrSideMm);
  const codeFont = Math.round(clamp(heightMm * 0.4, 10, 20) * (dotsPerMm / DEFAULT_DOTS_PER_MM));
  const detailFont = Math.round(clamp(heightMm * 0.32, 8, 16) * (dotsPerMm / DEFAULT_DOTS_PER_MM));

  const { size: moduleCount } = qrModules(item.code);
  const magnification = clamp(Math.round(qrSide / moduleCount), 1, 10);
  const actualSide = magnification * moduleCount;
  const x = Math.max(0, Math.round((labelW - actualSide) / 2));

  const lines = [
    "^XA",
    `^PW${labelW}`,
    `^LL${labelH}`,
    "^LH0,0",
    "^CI28",
    `^FO${x},${topMargin}`,
    // Model 2 (the recommended, more capable model) at the computed magnification. Error
    // correction M matches qr.ts's QR_ERROR_CORRECTION; "A" is automatic input mode, letting
    // the printer's own encoder pick the most compact segment mode for the data.
    "^BQN,2," + magnification,
    `^FDMA,${zplText(item.code)}^FS`,
  ];

  let y = topMargin + actualSide + mm(2);
  const codeLines = [item.code, ...item.lines];
  for (const line of codeLines) {
    if (y + detailFont > labelH) break;
    const font = line === item.code ? codeFont : detailFont;
    lines.push(
      `^FO0,${y}`,
      `^A0N,${font},${font}`,
      `^FB${labelW},1,0,C`,
      `^FD${zplText(line)}^FS`,
    );
    y += font + mm(1.5);
  }

  lines.push("^XZ");
  return lines.join("\n");
}

export function labelZpl(
  item: LabelItem,
  widthMm: number,
  heightMm: number,
  dotsPerMm: number = DEFAULT_DOTS_PER_MM,
  kind: LabelKind = "barcode",
): string {
  return kind === "qr"
    ? qrLabelZpl(item, widthMm, heightMm, dotsPerMm)
    : barcodeLabelZpl(item, widthMm, heightMm, dotsPerMm);
}

/** A whole run as one file. The printer reads them back to back and feeds one sticker per
 *  ^XA…^XZ block, so a 50-label run is 50 stickers with no further instruction. */
export function buildZpl(
  items: LabelItem[],
  widthMm: number,
  heightMm: number,
  dotsPerMm: number = DEFAULT_DOTS_PER_MM,
  kind: LabelKind = "barcode",
): string {
  return items.map((item) => labelZpl(item, widthMm, heightMm, dotsPerMm, kind)).join("\n");
}
