import QRCode from "qrcode";

/**
 * QR encoding, parallel to Label.tsx's CODE128 helper (drawBarcode).
 *
 * Error correction level M (recovers ~15% damage) is the standard middle ground for printed
 * labels: L is too fragile for a sticker that gets scuffed on a roll, H spends extra modules
 * on redundancy this app doesn't need since the plain-text code is always printed under it
 * as a fallback anyway.
 */
export const QR_ERROR_CORRECTION = "M" as const;

/** Draw a QR onto a canvas — the on-screen preview, and the image printHtml.ts embeds in
 *  the print page; same role drawBarcode plays for CODE128. */
export async function drawQr(canvas: HTMLCanvasElement, value: string): Promise<void> {
  await QRCode.toCanvas(canvas, value, { errorCorrectionLevel: QR_ERROR_CORRECTION, margin: 0 });
}
