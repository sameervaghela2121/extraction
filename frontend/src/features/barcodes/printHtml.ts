import { drawBarcode, type LabelItem } from "./Label";
import { drawQr } from "./qr";
import { computeLabelLayoutMm, computeQrLabelLayoutMm } from "./labelLayout";
import type { LabelKind } from "./labelSizes";

/**
 * A print-only HTML document for a run, handed to `window.print()` via a hidden iframe
 * (see printBatch in BarcodeGeneratorPage.tsx) instead of a downloaded PDF.
 *
 * This exists because a PDF's own page size gets reinterpreted by whichever PDF viewer
 * prints it — Chromium's built-in viewer in particular has a known habit of auto-rotating a
 * small, non-standard page size (a label is much wider or taller than it is the other way)
 * when it decides that lets it scale the page up further on the destination paper, no matter
 * what orientation the print dialog itself is set to. An HTML page using `@page { size }` is
 * printed directly by the browser's own layout engine instead of through that translation
 * layer, so there's no PDF page geometry for a viewer to reinterpret in the first place.
 *
 * Same margins/bar-height math as pdf.ts and tspl.ts (computeLabelLayoutMm /
 * computeQrLabelLayoutMm), just expressed in CSS mm instead of PDF points or printer dots, so
 * this looks like the same label regardless of which of the three you end up using.
 */

/** Barcode/QR rendered once per label onto an offscreen canvas, same encoders the on-screen
 *  preview uses, then embedded as a plain image — an HTML print page has no way to draw a
 *  barcode itself the way pdf.ts's vector rectangles or tspl.ts's `^BC`/`BARCODE` do. */
async function codeImageDataUrl(code: string, kind: LabelKind): Promise<string> {
  const canvas = document.createElement("canvas");
  if (kind === "qr") {
    await drawQr(canvas, code);
  } else {
    drawBarcode(canvas, code);
  }
  return canvas.toDataURL("image/png");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function buildPrintHtml(
  labels: LabelItem[],
  widthMm: number,
  heightMm: number,
  kind: LabelKind = "barcode",
): Promise<string> {
  // A QR is square and centred; a barcode spans the full width between the side margins.
  // Expressed as inline styles per label (not one shared class) since the image's own size
  // depends on this batch's kind, not just its physical dimensions.
  let sideMarginMm: number, topMarginMm: number, bottomMarginMm: number;
  let codeWidthMm: number, codeHeightMm: number;
  if (kind === "qr") {
    const layout = computeQrLabelLayoutMm(widthMm, heightMm);
    ({ sideMarginMm, topMarginMm, bottomMarginMm } = layout);
    codeWidthMm = codeHeightMm = layout.qrSideMm;
  } else {
    const layout = computeLabelLayoutMm(widthMm, heightMm);
    ({ sideMarginMm, topMarginMm, bottomMarginMm } = layout);
    codeWidthMm = widthMm - sideMarginMm * 2;
    codeHeightMm = layout.barHeightMm;
  }

  const pages = await Promise.all(
    labels.map(async (label) => {
      const img = await codeImageDataUrl(label.code, kind);
      const textLines = [label.code, ...label.lines]
        .map((line) => `<div class="line">${escapeHtml(line)}</div>`)
        .join("");
      return `
        <div class="label">
          <img class="code" src="${img}" style="width:${codeWidthMm}mm;height:${codeHeightMm}mm;" />
          ${textLines}
        </div>`;
    }),
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Print</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  .label {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    padding: ${topMarginMm}mm ${sideMarginMm}mm ${bottomMarginMm}mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: Helvetica, Arial, sans-serif;
    text-align: center;
    page-break-after: always;
    break-after: page;
  }
  .code { image-rendering: pixelated; object-fit: contain; }
  .line {
    font-size: 3mm;
    line-height: 1.4;
    max-width: 100%;
    overflow-wrap: break-word;
  }
</style>
</head>
<body>${pages.join("")}</body>
</html>`;
}
