import QRCode from "qrcode";

/**
 * QR encoding, parallel to Label.tsx's CODE128 helpers (drawBarcode/barPattern).
 *
 * Error correction level M (recovers ~15% damage) is the standard middle ground for printed
 * labels: L is too fragile for a sticker that gets scuffed on a roll, H spends extra modules
 * on redundancy this app doesn't need since the plain-text code is always printed under it
 * as a fallback anyway.
 */
export const QR_ERROR_CORRECTION = "M" as const;

/** Draw a QR onto a canvas — the on-screen preview only, same role drawBarcode plays for
 *  CODE128. The PDF does not go through a canvas; see qrModules below. */
export async function drawQr(canvas: HTMLCanvasElement, value: string): Promise<void> {
  await QRCode.toCanvas(canvas, value, { errorCorrectionLevel: QR_ERROR_CORRECTION, margin: 0 });
}

export interface QrModules {
  /** Modules per side — a QR is always square, so this is both width and height. */
  size: number;
  /** Row-major, one boolean per module: true = dark. */
  dark: boolean[];
}

/**
 * The module grid for a value, with no rendering involved.
 *
 * QRCode.create() runs the same encoder toCanvas() uses internally, but stops short of
 * drawing anything — which is what lets the PDF draw real vector squares (pdf.ts) and lets
 * the ZPL builder (zpl.ts) work out the exact magnification needed to hit a physical size,
 * both without ever touching a canvas.
 */
export function qrModules(value: string): QrModules {
  const qr = QRCode.create(value, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const { size, data } = qr.modules;
  // One plain 0/1 byte per module (qrcode's BitMatrix) — truthy check matches exactly what
  // the library's own canvas/SVG renderers do with this same array.
  const dark = Array.from(data, (bit) => Boolean(bit));
  return { size, dark };
}
