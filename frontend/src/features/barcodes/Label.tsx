import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { drawQr } from "./qr";
import type { LabelKind } from "./labelSizes";

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

/** Draw a code onto a canvas — the on-screen preview, and the image printHtml.ts embeds in
 *  the print page. */
export function drawBarcode(canvas: HTMLCanvasElement, value: string): void {
  JsBarcode(canvas, value, BARCODE_OPTIONS);
}

export default function Label({ item, kind = "barcode" }: { item: LabelItem; kind?: LabelKind }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (kind === "qr") {
      void drawQr(canvasRef.current, item.code);
    } else {
      drawBarcode(canvasRef.current, item.code);
    }
  }, [item.code, kind]);

  return (
    <div className={`barcode-label${kind === "qr" ? " barcode-label--qr" : ""}`}>
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
