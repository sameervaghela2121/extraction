import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** One printable label: the value that gets encoded, plus whatever should read under it. */
export interface LabelItem {
  /** Unique within the sheet — a roll id, or the generated code itself for a series. */
  key: string;
  /** What the barcode encodes and what prints beneath it. */
  code: string;
  /** Small print under the code: paper, size, location. Empty for a series label. */
  lines: string[];
}

/** CODE128 is what the roll numbers already scan as: variable length, alphanumeric, and
 *  read by every handheld in the godown. */
const BARCODE_OPTIONS = {
  format: "CODE128",
  width: 2,
  // Tall enough that a handheld reading a curved roll at an angle still finds a clean
  // scan line — roughly 15% of the printed code width, the usual floor for CODE128.
  height: 90,
  displayValue: false,
  margin: 0,
} as const;

/** Draw a code onto a canvas — the on-screen preview only. The PDF does not go through a
 *  canvas at all; it draws the pattern below as vector rectangles. */
export function drawBarcode(canvas: HTMLCanvasElement, value: string): void {
  JsBarcode(canvas, value, BARCODE_OPTIONS);
}

/**
 * The CODE128 module pattern for a code: "1" is a bar, "0" a space.
 *
 * JsBarcode fills `encodings` on any object handed to it, so the encoder can be used
 * without rendering anything — which is what lets the PDF draw real vectors instead of
 * photographing a canvas. Same encoder as the preview, so the two cannot disagree.
 */
export function barPattern(value: string): string {
  const out: { encodings?: Array<{ data: string }> } = {};
  JsBarcode(out, value, BARCODE_OPTIONS);
  return out.encodings?.[0]?.data ?? "";
}

export default function Label({ item }: { item: LabelItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawBarcode(canvasRef.current, item.code);
  }, [item.code]);

  return (
    <div className="barcode-label">
      <canvas ref={canvasRef} />
      <div className="barcode-label-code">{item.code}</div>
      {item.lines.map((line) => (
        <div key={line} className="barcode-label-meta">
          {line}
        </div>
      ))}
    </div>
  );
}
