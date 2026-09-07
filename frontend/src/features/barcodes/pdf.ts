/** A4 in PDF points (1/72 inch). */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 24;

const encoder = new TextEncoder();

export interface PdfPage {
  /** Raw JPEG bytes — PDF embeds them as-is via /DCTDecode, no re-encoding. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** Write pages of images as one PDF.
 *
 * ponytail: hand-rolled instead of pulling in a PDF library, because a label sheet is
 * always "one image, centred on A4" — no text, fonts, vectors or metadata. If this ever
 * needs selectable text or real vector barcodes, swap it for jsPDF rather than growing
 * this file. */
export function buildPdf(pages: PdfPage[]): Blob {
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

  // Objects 1 and 2 are the catalog and the page tree; each page then takes three.
  const pageId = (index: number) => 3 + index * 3;
  const pageIds = pages.map((_, index) => pageId(index));

  push("%PDF-1.4\n");
  writeObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObject(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );

  pages.forEach((page, index) => {
    const id = pageId(index);
    const contentsId = id + 1;
    const imageId = id + 2;

    // Fit inside the margins without distorting: a squashed barcode stops scanning.
    const scale = Math.min(
      (PAGE_WIDTH - MARGIN * 2) / page.width,
      (PAGE_HEIGHT - MARGIN * 2) / page.height,
      1,
    );
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const x = (PAGE_WIDTH - drawWidth) / 2;
    const y = PAGE_HEIGHT - MARGIN - drawHeight;
    const content = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

    writeObject(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`,
    );
    writeObject(contentsId, `<< /Length ${content.length} >>`, encoder.encode(content));
    writeObject(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      page.jpeg,
    );
  });

  const objectCount = 2 + pages.length * 3;
  const xrefOffset = offset;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

/** Strip the "data:image/jpeg;base64," header and decode to bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
