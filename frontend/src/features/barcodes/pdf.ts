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

/** PDF works in points; everything below is authored in mm and converted once. */
const MM = 72 / 25.4;

/** 100 x 50mm — the standard inventory/barcode label, and what the printer is loaded with.
 *  The page IS the label: a thermal printer feeds one sticker per page. */
const LABEL_W = 100 * MM;
const LABEL_H = 50 * MM;

const SIDE_MARGIN = 4 * MM;
const TOP_MARGIN = 4 * MM;
const BOTTOM_MARGIN = 4 * MM;

/** Tall bars give a handheld more scan lines to find, which is what makes an angled read
 *  off a curved roll work. */
const BAR_HEIGHT = 24 * MM;

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

const CODE_FONT = 11;
const DETAIL_FONT = 7;
const GAP = 1.5 * MM;

const encoder = new TextEncoder();

export interface PdfLabel {
  /** The module pattern, "1" = bar and "0" = space, straight from the CODE128 encoder. */
  bars: string;
  /** Printed under the bars, so a label is still usable when a scanner will not read it. */
  code: string;
  /** Small print under that. Empty on a blank label — the roll does not exist yet. */
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
function centredText(text: string, size: number, baseline: number): string {
  if (!text) return "";
  const x = (LABEL_W - textWidth(text, size)) / 2;
  return `BT /F1 ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${pdfString(text)}) Tj ET\n`;
}

/**
 * One label's drawing commands.
 *
 * Runs of consecutive "1"s are emitted as a single rectangle rather than one per module —
 * a wide bar is one wide rect. That is not only smaller output: adjacent rectangles can
 * leave hairline seams where a renderer rounds their edges differently, and a seam inside
 * a bar is exactly what a scanner reads as a narrower bar.
 */
function labelContent(label: PdfLabel): string {
  const modules = label.bars.length;
  const available = LABEL_W - SIDE_MARGIN * 2;
  // Shrink to fit a long code; never widen beyond the target.
  const module = Math.min(TARGET_MODULE, available / (modules + QUIET_MODULES * 2));

  const barsWidth = modules * module;
  const startX = (LABEL_W - barsWidth) / 2;
  const barsBottom = LABEL_H - TOP_MARGIN - BAR_HEIGHT;

  let content = "0 0 0 rg\n";
  let index = 0;
  while (index < modules) {
    if (label.bars[index] === "1") {
      let run = 1;
      while (index + run < modules && label.bars[index + run] === "1") run++;
      const x = startX + index * module;
      content +=
        `${x.toFixed(3)} ${barsBottom.toFixed(2)} ` +
        `${(run * module).toFixed(3)} ${BAR_HEIGHT.toFixed(2)} re f\n`;
      index += run;
    } else {
      index++;
    }
  }

  let baseline = barsBottom - GAP - CODE_FONT;
  content += centredText(label.code, CODE_FONT, baseline);
  for (const line of label.lines) {
    baseline -= GAP + DETAIL_FONT;
    if (baseline < BOTTOM_MARGIN) break;
    content += centredText(line, DETAIL_FONT, baseline);
  }
  return content;
}

/**
 * Every label as one PDF, a page each.
 *
 * Still hand-rolled rather than pulling in a PDF library: the whole document is rectangles
 * and one built-in font, which is a few hundred bytes of syntax. A library would be ~300kB
 * in the bundle to write the same thing.
 */
export function buildLabelPdf(labels: PdfLabel[]): Blob {
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
    const content = labelContent(label);
    const bytes = encoder.encode(content);

    writeObject(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LABEL_W.toFixed(2)} ${LABEL_H.toFixed(2)}] ` +
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
