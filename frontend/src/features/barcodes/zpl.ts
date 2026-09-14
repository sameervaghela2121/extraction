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
 * ZPL's own orientation letters, reused as-is rather than inventing our own vocabulary:
 * N = normal, R = rotated 90° clockwise, I = inverted 180°, B = rotated 270° clockwise
 * (equivalently 90° counter-clockwise, "read from the bottom up").
 *
 * Every field command that draws something (`^BC`, `^BQ`, `^A0`) takes one of these letters
 * and rotates its own content around its `^FO` origin — but ZPL does not have a single
 * command that rotates an already-composed label as a whole (that only exists for 180°, via
 * `^PO`). To get a consistent whole-label rotation for all four orientations, every field
 * here is given the same letter *and* has its origin remapped by rotateOrigin() below, so
 * the net effect is the same as if the whole label had been laid out and then physically
 * turned in the requested direction.
 */
export type ZplOrientation = "N" | "R" | "I" | "B";

/**
 * Maps a field's origin, as computed everywhere below for normal (N) orientation, to where
 * that origin needs to be for the label to come out rotated as a whole.
 *
 * Derived from first principles (2D rotation of the whole label rectangle, in ZPL's
 * y-grows-downward coordinate space, translated back to non-negative coordinates) rather
 * than guessed: for a field whose un-rotated box would occupy [lx, lx+fw] x [ly, ly+fh], the
 * physical origin ZPL needs — given that it rotates each field's own content the same amount
 * around its own origin — works out to depend only on the field's origin (lx, ly), not on
 * its width or height. That cancellation is what keeps this simple: every `^FO` call below
 * can be transformed without knowing how big the thing being drawn there is.
 *
 * `widthDots`/`heightDots` are the label's own nominal width/height (the same numbers used
 * for margins, font sizing, etc. everywhere else in this file) — never swapped, regardless
 * of orientation; only the physical page (`^PW`/`^LL`, computed separately) swaps for a
 * sideways rotation, because that's the printer's real print-head width, not a drawing
 * coordinate.
 */
function rotateOrigin(
  lx: number,
  ly: number,
  widthDots: number,
  heightDots: number,
  orientation: ZplOrientation,
): [x: number, y: number] {
  switch (orientation) {
    case "N":
      return [lx, ly];
    case "R":
      return [heightDots - ly, lx];
    case "I":
      return [widthDots - lx, heightDots - ly];
    case "B":
      return [ly, widthDots - lx];
  }
}

/**
 * One barcode label, sized to the physical sticker in `widthMm` x `heightMm`, at the given
 * printer resolution.
 *
 * The barcode is centred by measuring it first: ZPL places a barcode from its top-left and
 * has no notion of centring one, so the module count comes from the same encoder the
 * preview and the PDF use, and the origin is worked out from that.
 */
function barcodeLabelZpl(
  item: LabelItem,
  widthMm: number,
  heightMm: number,
  dotsPerMm: number,
  orientation: ZplOrientation,
): string {
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
  // Rotating 90°/270° turns the physical print width sideways — the label's own nominal
  // width/height (used for every margin and font above) never change, only which physical
  // axis of the roll they're printed across.
  const physicalW = orientation === "R" || orientation === "B" ? labelH : labelW;
  const physicalH = orientation === "R" || orientation === "B" ? labelW : labelH;
  const [barX, barY] = rotateOrigin(x, topMargin, labelW, labelH, orientation);

  const lines = [
    "^XA",
    // Stated on every label rather than left to the printer's saved defaults — a printer
    // configured for someone else's label size would otherwise silently crop ours.
    `^PW${physicalW}`,
    `^LL${physicalH}`,
    "^LH0,0",
    // UTF-8, so a separator like the middle dot prints as itself, not a mojibake byte.
    "^CI28",
    `^BY${module},2.5,${barHeight}`,
    `^FO${barX},${barY}`,
    // CODE128, interpretation line printed BELOW the bars by the printer — it centres that
    // under the symbol for us, and it cannot drift out of step with the bars the way
    // separately-placed text could. Orientation rotates the bars themselves the same way
    // rotateOrigin() has already repositioned them.
    `^BC${orientation},${barHeight},Y,N,N`,
    `^FD${zplText(item.code)}^FS`,
  ];

  // Anything else sits under the interpretation line, centred across the full label width.
  let y = topMargin + barHeight + codeFont + mm(3);
  for (const line of item.lines) {
    if (y + detailFont > labelH) break;
    const [lineX, lineY] = rotateOrigin(0, y, labelW, labelH, orientation);
    lines.push(
      `^FO${lineX},${lineY}`,
      `^A0${orientation},${detailFont},${detailFont}`,
      // Field block across the label: width, one line, no extra leading, centred. The block
      // width is the field's own local (pre-rotation) width, so it stays the label's nominal
      // width regardless of orientation — same reasoning as barHeight/module above.
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
function qrLabelZpl(
  item: LabelItem,
  widthMm: number,
  heightMm: number,
  dotsPerMm: number,
  orientation: ZplOrientation,
): string {
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
  const physicalW = orientation === "R" || orientation === "B" ? labelH : labelW;
  const physicalH = orientation === "R" || orientation === "B" ? labelW : labelH;
  const [qrX, qrY] = rotateOrigin(x, topMargin, labelW, labelH, orientation);

  const lines = [
    "^XA",
    `^PW${physicalW}`,
    `^LL${physicalH}`,
    "^LH0,0",
    "^CI28",
    `^FO${qrX},${qrY}`,
    // Model 2 (the recommended, more capable model) at the computed magnification. Error
    // correction M matches qr.ts's QR_ERROR_CORRECTION; "A" is automatic input mode, letting
    // the printer's own encoder pick the most compact segment mode for the data. A QR's own
    // finder patterns make it readable at any rotation regardless of what this orientation
    // letter does on a given printer's firmware — it's set for consistency, not correctness.
    `^BQ${orientation},2,${magnification}`,
    `^FDMA,${zplText(item.code)}^FS`,
  ];

  let y = topMargin + actualSide + mm(2);
  const codeLines = [item.code, ...item.lines];
  for (const line of codeLines) {
    if (y + detailFont > labelH) break;
    const font = line === item.code ? codeFont : detailFont;
    const [lineX, lineY] = rotateOrigin(0, y, labelW, labelH, orientation);
    lines.push(
      `^FO${lineX},${lineY}`,
      `^A0${orientation},${font},${font}`,
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
  orientation: ZplOrientation = "N",
): string {
  return kind === "qr"
    ? qrLabelZpl(item, widthMm, heightMm, dotsPerMm, orientation)
    : barcodeLabelZpl(item, widthMm, heightMm, dotsPerMm, orientation);
}

/** A whole run as one file. The printer reads them back to back and feeds one sticker per
 *  ^XA…^XZ block, so a 50-label run is 50 stickers with no further instruction. */
export function buildZpl(
  items: LabelItem[],
  widthMm: number,
  heightMm: number,
  dotsPerMm: number = DEFAULT_DOTS_PER_MM,
  kind: LabelKind = "barcode",
  orientation: ZplOrientation = "N",
): string {
  return items.map((item) => labelZpl(item, widthMm, heightMm, dotsPerMm, kind, orientation)).join("\n");
}
