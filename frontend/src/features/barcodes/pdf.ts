/**
 * One PDF page per label, drawn as vectors.
 *
 * This used to lay labels out on A4 as a JPEG image of a canvas. Three things were wrong
 * with that, and all of them cost scan reliability:
 *
 *  - The canvas was built at screen resolution and stretched to fill the page, so a printer
 *    asked for 203+ DPI was interpolating soft edges out of it.
 *  - JPEG is a photographic codec. On the hard black/white transitions a barcode is made of
 *    it leaves grey ringing either side of every bar.
 *  - The label size was an accident of "two columns on A4", which put the narrow bar at
 *    ~0.55mm — barely above where cheap scanners start failing.
 *
 * Here a bar is a filled rectangle at an exact millimetre coordinate. There is no
 * resolution and nothing to compress: the printer renders it at its own dot pitch, so the
 * same file is sharp on a 203 DPI thermal printer and a 1200 DPI laser.
 */

import { clamp, computeLabelLayoutMm, computeQrLabelLayoutMm } from "./labelLayout";
import { barPattern } from "./Label";
import { qrModules } from "./qr";
import type { LabelKind } from "./labelSizes";

/** PDF works in points; everything below is authored in mm and converted once. */
const MM = 72 / 25.4;

/** Tall bars give a handheld more scan lines to find, which is what makes an angled read
 *  off a curved roll work — see labelLayout.ts for how this scales with label height. */

/**
 * Narrow-bar width, and the number that decides whether any of this scans.
 *
 * 0.5mm is comfortable for a 203 DPI thermal printer (4 dots). Shrunk automatically if a
 * long code will not fit, never grown — a wider bar than needed just wastes label.
 */
const TARGET_MODULE = 0.5 * MM;

/** CODE128 needs at least 10 clear modules each side or a scanner cannot find the symbol
 *  at all. The most commonly violated part of the spec, and it fails silently. */
const QUIET_MODULES = 10;

const GAP = 1.5 * MM;

const encoder = new TextEncoder();

export interface PdfLabel {
  /** What the code encodes. The bar/module pattern is computed here from this, per `kind`,
   *  rather than passed in — one caller, one place that decides how a value becomes marks. */
  code: string;
  /** Printed under the code (or the QR), so a label is still usable when a scanner will not
   *  read it. */
  lines: string[];
}

/**
 * Helvetica advance widths, in 1/1000 em, for the characters a label actually carries.
 *
 * Needed because PDF has no concept of centred text: a string is drawn from wherever it is
 * placed, so the width has to be known to centre it. Only the printable set is listed;
 * anything else falls back to a digit's width, which is close enough that a millimetre of
 * drift on a label is invisible.
 */
const HELVETICA: Record<string, number> = {
  " ": 278, "-": 333, ".": 278, "/": 278, ":": 278, "·": 333,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

function textWidth(text: string, size: number): number {
  let total = 0;
  for (const ch of text) total += HELVETICA[ch] ?? 556;
  return (total / 1000) * size;
}

/** Escape for a PDF literal string, and map the separator to its WinAnsi code point. */
function pdfString(text: string): string {
  return text
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/·/g, "\\267");
}

/** Centred single line of text as a content-stream fragment. */
function centredText(text: string, size: number, baseline: number, labelW: number): string {
  if (!text) return "";
  const x = (labelW - textWidth(text, size)) / 2;
  return `BT /F1 ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${pdfString(text)}) Tj ET\n`;
}

/** Every measurement one label's drawing commands need, in points, for the requested
 *  physical size — computed once per PDF rather than once per label. */
interface Geometry {
  labelW: number;
  labelH: number;
  sideMargin: number;
  topMargin: number;
  bottomMargin: number;
  barHeight: number;
  codeFont: number;
  detailFont: number;
}

function computeGeometry(widthMm: number, heightMm: number): Geometry {
  const layout = computeLabelLayoutMm(widthMm, heightMm);
  return {
    labelW: widthMm * MM,
    labelH: heightMm * MM,
    sideMargin: layout.sideMarginMm * MM,
    topMargin: layout.topMarginMm * MM,
    bottomMargin: layout.bottomMarginMm * MM,
    barHeight: layout.barHeightMm * MM,
    // Tuned to reproduce the original fixed 11pt/7pt at the original 100x50mm label.
    codeFont: clamp(heightMm * 0.22, 7, 11),
    detailFont: clamp(heightMm * 0.14, 5, 7),
  };
}

/** Same role as Geometry above, for a QR label — barHeight becomes qrSide, a square rather
 *  than a horizontal band. */
interface QrGeometry {
  labelW: number;
  labelH: number;
  sideMargin: number;
  topMargin: number;
  bottomMargin: number;
  qrSide: number;
  codeFont: number;
  detailFont: number;
}

function computeQrGeometry(widthMm: number, heightMm: number): QrGeometry {
  const layout = computeQrLabelLayoutMm(widthMm, heightMm);
  return {
    labelW: widthMm * MM,
    labelH: heightMm * MM,
    sideMargin: layout.sideMarginMm * MM,
    topMargin: layout.topMarginMm * MM,
    bottomMargin: layout.bottomMarginMm * MM,
    qrSide: layout.qrSideMm * MM,
    codeFont: clamp(heightMm * 0.13, 6, 10),
    detailFont: clamp(heightMm * 0.09, 5, 7),
  };
}

/**
 * One barcode label's drawing commands.
 *
 * Runs of consecutive "1"s are emitted as a single rectangle rather than one per module —
 * a wide bar is one wide rect. That is not only smaller output: adjacent rectangles can
 * leave hairline seams where a renderer rounds their edges differently, and a seam inside
 * a bar is exactly what a scanner reads as a narrower bar.
 */
function barcodeLabelContent(label: PdfLabel, g: Geometry): string {
  const bars = barPattern(label.code);
  const modules = bars.length;
  const available = g.labelW - g.sideMargin * 2;
  // Shrink to fit a long code; never widen beyond the target.
  const module = Math.min(TARGET_MODULE, available / (modules + QUIET_MODULES * 2));

  const barsWidth = modules * module;
  const startX = (g.labelW - barsWidth) / 2;
  const barsBottom = g.labelH - g.topMargin - g.barHeight;

  let content = "0 0 0 rg\n";
  let index = 0;
  while (index < modules) {
    if (bars[index] === "1") {
      let run = 1;
      while (index + run < modules && bars[index + run] === "1") run++;
      const x = startX + index * module;
      content +=
        `${x.toFixed(3)} ${barsBottom.toFixed(2)} ` +
        `${(run * module).toFixed(3)} ${g.barHeight.toFixed(2)} re f\n`;
      index += run;
    } else {
      index++;
    }
  }

  let baseline = barsBottom - GAP - g.codeFont;
  content += centredText(label.code, g.codeFont, baseline, g.labelW);
  for (const line of label.lines) {
    baseline -= GAP + g.detailFont;
    if (baseline < g.bottomMargin) break;
    content += centredText(line, g.detailFont, baseline, g.labelW);
  }
  return content;
}

/**
 * One QR label's drawing commands.
 *
 * Same run-merging idea as the barcode path, but per row: a QR's dark cells are irregular
 * rather than banded into a handful of wide bars, so each row still yields several runs
 * rather than one, but far fewer rectangles than one per module.
 */
function qrLabelContent(label: PdfLabel, g: QrGeometry): string {
  const { size, dark } = qrModules(label.code);
  const module = g.qrSide / size;
  const startX = (g.labelW - g.qrSide) / 2;
  // PDF's y axis runs bottom-up, so the QR's top edge — row 0 of the matrix — sits at
  // labelH minus the top margin, not at the top margin itself (that would put the whole
  // QR down near the bottom of the label, which is the bug this replaced).
  const qrTopY = g.labelH - g.topMargin;

  let content = "0 0 0 rg\n";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (dark[row * size + col]) {
        let run = 1;
        while (col + run < size && dark[row * size + col + run]) run++;
        const x = startX + col * module;
        const y = qrTopY - (row + 1) * module;
        content += `${x.toFixed(3)} ${y.toFixed(3)} ${(run * module).toFixed(3)} ${module.toFixed(3)} re f\n`;
        col += run;
      } else {
        col++;
      }
    }
  }

  let baseline = g.labelH - g.topMargin - g.qrSide - GAP - g.codeFont;
  content += centredText(label.code, g.codeFont, baseline, g.labelW);
  for (const line of label.lines) {
    baseline -= GAP + g.detailFont;
    if (baseline < g.bottomMargin) break;
    content += centredText(line, g.detailFont, baseline, g.labelW);
  }
  return content;
}

/**
 * Every label as one PDF, a page each, sized to the physical sticker in `widthMm` x
 * `heightMm` — the page IS the label: a thermal printer feeds one sticker per page.
 *
 * Still hand-rolled rather than pulling in a PDF library: the whole document is rectangles
 * and one built-in font, which is a few hundred bytes of syntax. A library would be ~300kB
 * in the bundle to write the same thing.
 */
export function buildLabelPdf(
  labels: PdfLabel[],
  widthMm: number,
  heightMm: number,
  kind: LabelKind = "barcode",
): Blob {
  const barcodeGeometry = kind === "barcode" ? computeGeometry(widthMm, heightMm) : null;
  const qrGeometry = kind === "qr" ? computeQrGeometry(widthMm, heightMm) : null;
  const geometry = (barcodeGeometry ?? qrGeometry)!;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  const push = (data: Uint8Array | string) => {
    const buffer = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(buffer);
    offset += buffer.length;
  };
  const writeObject = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // 1 catalog, 2 page tree, 3 font, then two objects per page.
  const pageId = (index: number) => 4 + index * 2;

  push("%PDF-1.4\n");
  writeObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObject(
    2,
    `<< /Type /Pages /Count ${labels.length} /Kids [${labels
      .map((_, i) => `${pageId(i)} 0 R`)
      .join(" ")}] >>`,
  );
  // Helvetica is one of the 14 fonts every PDF reader ships with, so nothing is embedded.
  writeObject(
    3,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  labels.forEach((label, index) => {
    const id = pageId(index);
    const contentsId = id + 1;
    const content =
      kind === "qr" ? qrLabelContent(label, qrGeometry!) : barcodeLabelContent(label, barcodeGeometry!);
    const bytes = encoder.encode(content);

    writeObject(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${geometry.labelW.toFixed(2)} ${geometry.labelH.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentsId} 0 R >>`,
    );
    writeObject(contentsId, `<< /Length ${bytes.length} >>`, bytes);
  });

  const objectCount = 3 + labels.length * 2;
  const xrefOffset = offset;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
