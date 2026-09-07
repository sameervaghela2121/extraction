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

/** Draw a code onto a canvas. Shared by the on-screen label and the PNG download so what
 *  you print and what you download can't drift apart. */
export function drawBarcode(canvas: HTMLCanvasElement, value: string): void {
  JsBarcode(canvas, value, BARCODE_OPTIONS);
}

const PAD = 12;
const CODE_SIZE = 18;
const META_SIZE = 13;
const LINE_GAP = 5;

/** The downloadable label: bars plus the same text the printed label carries. JsBarcode
 *  can draw the code itself, but not the meta lines, so the whole label is composed here
 *  onto one canvas — a bare barcode is unreadable to anyone holding the roll. */
export function renderLabel(item: LabelItem): HTMLCanvasElement {
  const bars = document.createElement("canvas");
  drawBarcode(bars, item.code);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return bars;

  // Measure first: a long location line can be wider than the barcode itself.
  ctx.font = `700 ${CODE_SIZE}px sans-serif`;
  let contentWidth = Math.max(bars.width, ctx.measureText(item.code).width);
  ctx.font = `${META_SIZE}px sans-serif`;
  for (const line of item.lines) {
    contentWidth = Math.max(contentWidth, ctx.measureText(line).width);
  }

  canvas.width = Math.ceil(contentWidth) + PAD * 2;
  canvas.height =
    bars.height + CODE_SIZE + item.lines.length * (META_SIZE + LINE_GAP) + LINE_GAP + PAD * 2;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bars, Math.round((canvas.width - bars.width) / 2), PAD);

  const center = canvas.width / 2;
  ctx.textAlign = "center";
  let y = PAD + bars.height + LINE_GAP + CODE_SIZE;
  ctx.fillStyle = "#000";
  ctx.font = `700 ${CODE_SIZE}px sans-serif`;
  ctx.fillText(item.code, center, y);

  ctx.fillStyle = "#444";
  ctx.font = `${META_SIZE}px sans-serif`;
  for (const line of item.lines) {
    y += META_SIZE + LINE_GAP;
    ctx.fillText(line, center, y);
  }
  return canvas;
}

// Two across, not three: on A4 that puts each label at ~85mm wide, so the narrow bar is
// ~0.55mm instead of the 0.36mm a 3-up sheet gave — well clear of what cheap scanners miss.
const SHEET_COLUMNS = 2;
const SHEET_GAP = 24;

/** The whole selection as one image, laid out like the printed sheet. Cells are sized to
 *  the widest/tallest label so every barcode keeps its own scale — scaling bars down to
 *  fit a uniform cell is what makes a label stop scanning. */
export function renderSheet(items: LabelItem[]): HTMLCanvasElement {
  const labels = items.map(renderLabel);
  const cellWidth = Math.max(...labels.map((l) => l.width));
  const cellHeight = Math.max(...labels.map((l) => l.height));
  const columns = Math.min(SHEET_COLUMNS, labels.length);
  const rows = Math.ceil(labels.length / columns);

  const canvas = document.createElement("canvas");
  canvas.width = columns * cellWidth + (columns + 1) * SHEET_GAP;
  canvas.height = rows * cellHeight + (rows + 1) * SHEET_GAP;
  const ctx = canvas.getContext("2d");
  if (!ctx) return labels[0];

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // A thin box around each label is the cut line — without it there's nothing to aim
  // scissors at on a white sheet.
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  labels.forEach((label, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = SHEET_GAP + column * (cellWidth + SHEET_GAP);
    const cellY = SHEET_GAP + row * (cellHeight + SHEET_GAP);
    ctx.strokeRect(cellX + 0.5, cellY + 0.5, cellWidth, cellHeight);
    ctx.drawImage(label, Math.round(cellX + (cellWidth - label.width) / 2), cellY);
  });
  return canvas;
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
