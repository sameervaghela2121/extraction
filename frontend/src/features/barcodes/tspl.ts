import { barPattern, type LabelItem } from "./Label";
import { clamp, computeLabelLayoutMm, computeQrLabelLayoutMm } from "./labelLayout";
import { qrModules } from "./qr";
import type { LabelKind } from "./labelSizes";

/**
 * TSPL — the language TSC printers actually speak natively.
 *
 * zpl.ts sends ZPL, which TSC printers can *also* understand, but only when a "TSPL-EZD"
 * compatibility mode is active on that unit — and on the hardware this app was tested
 * against, that mode either isn't on or isn't working: raw ZPL came out printed as literal
 * text ("^CI28 ^BY150,2...") instead of being interpreted, even sent through a CUPS raw
 * queue with no filtering in the way. TSPL sidesteps that guesswork entirely, since it's
 * what the printer parses out of the box with no mode to get right.
 *
 * The overall approach mirrors zpl.ts: coordinates in dots (not mm), computed from the same
 * shared layout math in labelLayout.ts, so a batch looks the same whichever file you send.
 */

/** Same reasoning as zpl.ts: 203dpi (8 dots/mm) is the standard for this printer class, but
 *  every measurement below is computed from the requested resolution rather than assumed. */
const DEFAULT_DOTS_PER_MM = 8;

/** Matches zpl.ts's narrow-bar width — same physical bar, same scan reliability reasoning. */
const MODULE_MM = 0.5;

/**
 * The setup block TSC's own driver produced for a real, working print job on this exact
 * printer (captured from its raster-to-TSPL filter output) — reused here as calibrated
 * defaults rather than guessed values, since they're proven to work on this hardware.
 * `SPEED`/`DENSITY` in particular are tuned to a specific ribbon/stock combination and may
 * need adjusting for different media; everything else (DIRECTION/REFERENCE/OFFSET/the SET
 * commands) are safe, printer-agnostic defaults with no cutter/peeler hardware assumed.
 */
const SPEED = 3;
const DENSITY = 14;

/** TSPL has no escape character of its own for field data the way ZPL does, but a stray
 *  double-quote would terminate the string early and corrupt the command — our codes are
 *  alphanumeric and never contain one, but the detail line is free text. */
function tsplText(value: string): string {
  return value.replace(/"/g, "'");
}

/**
 * Same four orientations as zpl.ts's ZplOrientation, reused as a distinct type since TSPL's
 * own rotation vocabulary is numeric (0/1/2/3), not these letters — the mapping happens at
 * the call site below.
 */
export type TsplOrientation = "N" | "R" | "I" | "B";

const ROTATION_CODE: Record<TsplOrientation, 0 | 1 | 2 | 3> = { N: 0, R: 1, I: 2, B: 3 };

/**
 * Maps a field's origin, computed everywhere below for normal (N) orientation, to where it
 * needs to be for the whole label to come out rotated — same derivation as zpl.ts's
 * rotateOrigin (2D rotation of the whole label rectangle, translated back to non-negative
 * coordinates). TSPL's BARCODE/TEXT rotation parameter is documented to rotate a field's
 * content around its own x,y in the same way ZPL's orientation letter does, which is why the
 * same transform applies — this hasn't been verified against a live 90°/270° print on this
 * printer the way 0°/180° have, so treat those two as a first pass to test.
 */
function rotateOrigin(
  lx: number,
  ly: number,
  widthDots: number,
  heightDots: number,
  orientation: TsplOrientation,
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

/** TSPL's built-in font "0" is documented at roughly 8 (w) x 12 (h) dots per magnification
 *  step of 1 — the x/y multiplier arguments TEXT takes. Converts a desired dot height into
 *  the multiplier that gets closest to it, clamped to TSPL's 1-10 magnification range (the
 *  same range ^BQ's magnification is clamped to in zpl.ts, for the same reason: beyond that
 *  the printer can't scale the built-in font any further). */
function fontMultiplierFor(desiredHeightDots: number): number {
  return clamp(Math.round(desiredHeightDots / 12), 1, 10);
}

interface Geometry {
  labelW: number;
  labelH: number;
  /** Physical print width/height in mm — same as widthMm/heightMm unless rotated 90°/270°,
   *  in which case they're swapped. Kept in mm (not converted from the dot values below) so
   *  the SIZE command is exact regardless of dotsPerMm, rather than round-tripping through a
   *  dot conversion at a resolution that might not match the one used to compute labelW/H. */
  physicalWidthMm: number;
  physicalHeightMm: number;
}

function geometryFor(widthMm: number, heightMm: number, dotsPerMm: number, orientation: TsplOrientation): Geometry {
  const mm = (value: number) => Math.round(value * dotsPerMm);
  const labelW = mm(widthMm);
  const labelH = mm(heightMm);
  // Rotating 90°/270° turns the physical print width sideways — same reasoning as zpl.ts's
  // ^PW/^LL swap: the label's own nominal width/height never change, only which physical
  // axis of the roll they're printed across.
  const sideways = orientation === "R" || orientation === "B";
  return {
    labelW,
    labelH,
    physicalWidthMm: sideways ? heightMm : widthMm,
    physicalHeightMm: sideways ? widthMm : heightMm,
  };
}

/** The setup commands shared by every label in a run, sized to the physical sticker. */
function setupCommands(g: Geometry): string[] {
  return [
    `SIZE ${g.physicalWidthMm.toFixed(1)} mm, ${g.physicalHeightMm.toFixed(1)} mm`,
    // The physical gap between die-cut labels on the roll — confirmed on the actual TH340
    // that GAP 0 (continuous-stock assumption) printed nothing visible, while a 2mm gap
    // printed correctly. 2mm is a common die-cut label spec, not a measurement of this
    // specific roll — if positioning drifts from label to label, measure the real gap on
    // the stock and adjust this to match.
    "GAP 2 mm, 0 mm",
    `SPEED ${SPEED}`,
    `DENSITY ${DENSITY}`,
    "DIRECTION 0,0",
    "REFERENCE 0,0",
    "OFFSET 0 mm",
    "SET PEEL OFF",
    "SET CUTTER OFF",
    "SET PARTIAL_CUTTER OFF",
    // Confirmed on the actual TH340: TEAR ON makes the printer feed each label to the tear
    // bar and pause there, waiting for it to be torn off before continuing — fine for one
    // label at a time, but it stops a multi-label batch between every single sticker. TEAR
    // OFF prints the whole run back-to-back, matching how the original ZPL flow always ran.
    "SET TEAR OFF",
  ];
}

/**
 * One barcode label, sized to the physical sticker in `widthMm` x `heightMm`.
 *
 * The barcode is centred by measuring it first: TSPL places a barcode from its top-left and
 * has no notion of centring one, so the module count comes from the same encoder the
 * preview and the PDF use, and the origin is worked out from that — same approach as
 * barcodeLabelZpl in zpl.ts.
 */
function barcodeLabelTspl(
  item: LabelItem,
  widthMm: number,
  heightMm: number,
  dotsPerMm: number,
  orientation: TsplOrientation,
): string {
  const mm = (value: number) => Math.round(value * dotsPerMm);
  const module = mm(MODULE_MM);
  const g = geometryFor(widthMm, heightMm, dotsPerMm, orientation);

  const layout = computeLabelLayoutMm(widthMm, heightMm);
  const topMargin = mm(layout.topMarginMm);
  const barHeight = mm(layout.barHeightMm);
  // Same target text heights (in mm) pdf.ts's codeFont/detailFont clamps work out to, just
  // expressed directly in mm here instead of by round-tripping through PDF points.
  const codeMult = fontMultiplierFor(mm(clamp(heightMm * 0.078, 2.5, 3.9)));
  const detailMult = fontMultiplierFor(mm(clamp(heightMm * 0.049, 1.8, 2.5)));

  const modules = barPattern(item.code).length;
  const barsWidth = modules * module;
  const x = Math.max(0, Math.round((g.labelW - barsWidth) / 2));
  const [barX, barY] = rotateOrigin(x, topMargin, g.labelW, g.labelH, orientation);
  const rotation = ROTATION_CODE[orientation];

  const lines = [
    "CLS",
    // "128" is Code128's Auto subset-selection mode — plain text in, the printer's own
    // encoder picks the shortest subset switching, the same optimisation jsbarcode already
    // does for the on-screen preview and the PDF. HRI (human-readable interpretation line)
    // is off: this app draws its own TEXT line below instead, so the two can't disagree.
    `BARCODE ${barX},${barY},"128",${barHeight},0,${rotation},${module},${module * 2},"${tsplText(item.code)}"`,
  ];

  let y = topMargin + barHeight + Math.round(3 * dotsPerMm);
  const codeLineHeight = codeMult * 12;
  const [codeX, codeY] = rotateOrigin(0, y, g.labelW, g.labelH, orientation);
  lines.push(`TEXT ${codeX},${codeY},"0",${rotation},${codeMult},${codeMult},"${tsplText(item.code)}"`);
  y += codeLineHeight + Math.round(1.5 * dotsPerMm);

  const detailLineHeight = detailMult * 12;
  for (const line of item.lines) {
    if (y + detailLineHeight > g.labelH) break;
    const [lineX, lineY] = rotateOrigin(0, y, g.labelW, g.labelH, orientation);
    lines.push(`TEXT ${lineX},${lineY},"0",${rotation},${detailMult},${detailMult},"${tsplText(line)}"`);
    y += detailLineHeight + Math.round(1.5 * dotsPerMm);
  }

  lines.push("PRINT 1,1");
  return lines.join("\r\n");
}

/**
 * One QR label, mirroring qrLabelZpl in zpl.ts.
 *
 * TSPL draws the QR itself via its own QRCODE command, the same way ZPL's ^BQ does — nothing
 * is rendered here, just told where to put it and how big.
 */
function qrLabelTspl(
  item: LabelItem,
  widthMm: number,
  heightMm: number,
  dotsPerMm: number,
  orientation: TsplOrientation,
): string {
  const mm = (value: number) => Math.round(value * dotsPerMm);
  const g = geometryFor(widthMm, heightMm, dotsPerMm, orientation);

  const layout = computeQrLabelLayoutMm(widthMm, heightMm);
  const topMargin = mm(layout.topMarginMm);
  const qrSide = mm(layout.qrSideMm);
  // Same target text heights pdf.ts's QR-label codeFont/detailFont clamps work out to.
  const codeMult = fontMultiplierFor(mm(clamp(heightMm * 0.046, 2.1, 3.5)));
  const detailMult = fontMultiplierFor(mm(clamp(heightMm * 0.032, 1.8, 2.5)));

  // TSPL's QRCODE sizes by a cell width in dots per module, not a target pixel side, so the
  // module count (known ahead of time via the same encoder the preview and PDF use) picks
  // the cell width that best fills the space this label has for it.
  const { size: moduleCount } = qrModules(item.code);
  const cellWidth = clamp(Math.round(qrSide / moduleCount), 1, 10);
  const actualSide = cellWidth * moduleCount;
  const x = Math.max(0, Math.round((g.labelW - actualSide) / 2));
  const [qrX, qrY] = rotateOrigin(x, topMargin, g.labelW, g.labelH, orientation);
  const rotation = ROTATION_CODE[orientation];

  const lines = [
    "CLS",
    // Model 2, error correction M (matches qr.ts's QR_ERROR_CORRECTION), Auto input mode.
    `QRCODE ${qrX},${qrY},M,${cellWidth},A,${rotation},"${tsplText(item.code)}"`,
  ];

  let y = topMargin + actualSide + Math.round(2 * dotsPerMm);
  const codeLines = [item.code, ...item.lines];
  const codeLineHeight = codeMult * 12;
  const detailLineHeight = detailMult * 12;
  for (const line of codeLines) {
    const isCode = line === item.code;
    const lineHeight = isCode ? codeLineHeight : detailLineHeight;
    if (y + lineHeight > g.labelH) break;
    const mult = isCode ? codeMult : detailMult;
    const [lineX, lineY] = rotateOrigin(0, y, g.labelW, g.labelH, orientation);
    lines.push(`TEXT ${lineX},${lineY},"0",${rotation},${mult},${mult},"${tsplText(line)}"`);
    y += lineHeight + Math.round(1.5 * dotsPerMm);
  }

  lines.push("PRINT 1,1");
  return lines.join("\r\n");
}

export function labelTspl(
  item: LabelItem,
  widthMm: number,
  heightMm: number,
  dotsPerMm: number = DEFAULT_DOTS_PER_MM,
  kind: LabelKind = "barcode",
  orientation: TsplOrientation = "N",
): string {
  return kind === "qr"
    ? qrLabelTspl(item, widthMm, heightMm, dotsPerMm, orientation)
    : barcodeLabelTspl(item, widthMm, heightMm, dotsPerMm, orientation);
}

/** A whole run as one file: one setup block (the printer keeps it until told otherwise),
 *  then one CLS/.../PRINT block per label — unlike ZPL's ^XA...^XZ, TSPL doesn't repeat the
 *  size/speed/density setup per label, so it's sent once up front. */
export function buildTspl(
  items: LabelItem[],
  widthMm: number,
  heightMm: number,
  dotsPerMm: number = DEFAULT_DOTS_PER_MM,
  kind: LabelKind = "barcode",
  orientation: TsplOrientation = "N",
): string {
  if (items.length === 0) return "";
  const g = geometryFor(widthMm, heightMm, dotsPerMm, orientation);
  const setup = setupCommands(g);
  const labels = items.map((item) => labelTspl(item, widthMm, heightMm, dotsPerMm, kind, orientation));
  // TSPL commands must be CRLF-terminated — a plain LF-only stream leaves the printer's
  // parser unable to find the end of a command, and a printer that can't parse the stream as
  // commands falls back to printing it as literal text, which is exactly the symptom this
  // fixes. The trailing CRLF terminates the final PRINT the same way every line before it is.
  return [...setup, ...labels].join("\r\n") + "\r\n";
}
