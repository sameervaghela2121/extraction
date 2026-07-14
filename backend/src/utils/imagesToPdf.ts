import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

/**
 * Merge camera-captured photos into a single multi-page PDF, one page per image
 * in the given order. Phone photos carry EXIF orientation rather than physically
 * rotated pixels, so each image is normalized (auto-rotated, re-encoded to JPEG)
 * before being embedded — otherwise sideways pages would reach the extraction
 * service and hurt OCR accuracy.
 */
export async function imagesToPdf(buffers: Buffer[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  for (const buffer of buffers) {
    const normalized = await sharp(buffer).rotate().jpeg({ quality: 92 }).toBuffer();
    const jpg = await pdfDoc.embedJpg(normalized);
    const page = pdfDoc.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
  }

  return Buffer.from(await pdfDoc.save());
}
