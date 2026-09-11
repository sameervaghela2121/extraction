import { barPattern, type LabelItem } from "./Label";

/**
 * ZPL — the language thermal label printers speak.
 *
 * Nothing is rendered here. A PDF has to draw every bar as a rectangle at a coordinate we
 * compute; ZPL just says "put a CODE128 of this text at this spot" and the printer draws it
 * at its own exact dot pitch. That is why a thermal printer's output is dimensionally
 * perfect where a PDF's depends on the print dialog not scaling anything.
 *
 * Zebra invented ZPL, but TSC and Honeywell printers read it too, so this is not a
 * commitment to one brand.
 */

/** 203 dpi is the standard resolution for this class of printer: 8 dots per mm. */
const DOTS_PER_MM = 8;
const mm = (value: number) => Math.round(value * DOTS_PER_MM);

/** Same 100 x 50mm label the PDF targets, so both paths print the identical sticker. */
const LABEL_W = mm(100);
const LABEL_H = mm(50);

/** 4 dots = 0.5mm, the narrow-bar width. Whole dots on purpose: a fractional module makes
 *  the printer round some bars up and some down, and inconsistent bars are what a scanner
 *  reads as a bad symbol. */
const MODULE = 4;
const BAR_HEIGHT = mm(24);
const TOP_MARGIN = mm(4);

/** Sized in dots, not points — ZPL's scalable font takes a dot height. */
const CODE_FONT = 34;
const DETAIL_FONT = 22;

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
 * One label.
 *
 * The barcode is centred by measuring it first: ZPL places a barcode from its top-left and
 * has no notion of centring one, so the module count comes from the same encoder the
 * preview and the PDF use, and the origin is worked out from that.
 */
export function labelZpl(item: LabelItem): string {
  const modules = barPattern(item.code).length;
  const barsWidth = modules * MODULE;
  const x = Math.max(0, Math.round((LABEL_W - barsWidth) / 2));

  const lines = [
    "^XA",
    // Stated on every label rather than left to the printer's saved defaults — a printer
    // configured for someone else's label size would otherwise silently crop ours.
    `^PW${LABEL_W}`,
    `^LL${LABEL_H}`,
    "^LH0,0",
    // UTF-8, so a separator like the middle dot prints as itself, not a mojibake byte.
    "^CI28",
    `^BY${MODULE},2.5,${BAR_HEIGHT}`,
    `^FO${x},${TOP_MARGIN}`,
    // CODE128, normal orientation, interpretation line printed BELOW the bars by the
    // printer — it centres that under the symbol for us, and it cannot drift out of step
    // with the bars the way separately-placed text could.
    `^BCN,${BAR_HEIGHT},Y,N,N`,
    `^FD${zplText(item.code)}^FS`,
  ];

  // Anything else sits under the interpretation line, centred across the full label width.
  let y = TOP_MARGIN + BAR_HEIGHT + CODE_FONT + mm(3);
  for (const line of item.lines) {
    if (y + DETAIL_FONT > LABEL_H) break;
    lines.push(
      `^FO0,${y}`,
      `^A0N,${DETAIL_FONT},${DETAIL_FONT}`,
      // Field block across the label: width, one line, no extra leading, centred.
      `^FB${LABEL_W},1,0,C`,
      `^FD${zplText(line)}^FS`,
    );
    y += DETAIL_FONT + mm(1.5);
  }

  lines.push("^XZ");
  return lines.join("\n");
}

/** A whole run as one file. The printer reads them back to back and feeds one sticker per
 *  ^XA…^XZ block, so a 50-label run is 50 stickers with no further instruction. */
export function buildZpl(items: LabelItem[]): string {
  return items.map(labelZpl).join("\n");
}
