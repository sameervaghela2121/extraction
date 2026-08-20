import axios from "axios";
import sharp from "sharp";
import { env } from "../config/env";

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const REQUEST_TIMEOUT_MS = 20_000;
// Vision does its own binarisation, so it wants the photo close to original — only the
// EXIF rotation and a size cap, none of the thresholding tesseract needs.
const MAX_WIDTH = 2600;
const JPEG_QUALITY = 90;

type VisionWord = { confidence?: number };
type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
      pages?: Array<{
        blocks?: Array<{
          paragraphs?: Array<{ words?: VisionWord[] }>;
        }>;
      }>;
    };
    error?: { message?: string };
  }>;
};

export const isVisionConfigured = (): boolean => env.googleVisionApiKey !== "";

/** Mean word confidence across the page — Vision reports it per word, like tesseract. */
function meanConfidence(response: NonNullable<VisionResponse["responses"]>[number]): number {
  const words: VisionWord[] =
    response.fullTextAnnotation?.pages?.flatMap(
      (page) =>
        page.blocks?.flatMap((block) => block.paragraphs?.flatMap((p) => p.words ?? []) ?? []) ?? [],
    ) ?? [];
  const scored = words.map((w) => w.confidence).filter((c): c is number => typeof c === "number");
  if (scored.length === 0) return 0;
  return Math.round((scored.reduce((sum, c) => sum + c, 0) / scored.length) * 1000) / 1000;
}

/**
 * DOCUMENT_TEXT_DETECTION rather than TEXT_DETECTION: it is the dense-document model and
 * it keeps the reading order of a form, which is what a roll label is.
 */
export async function readWithVision(image: Buffer): Promise<{ lines: string[]; confidence: number }> {
  const prepared = await sharp(image)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const { data } = await axios.post<VisionResponse>(
    ENDPOINT,
    {
      requests: [
        {
          image: { content: prepared.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["en"] },
        },
      ],
    },
    // Header, not ?key= — a query-string key ends up in axios error objects, proxy logs
    // and access logs. The header stays out of all three.
    {
      headers: { "X-Goog-Api-Key": env.googleVisionApiKey },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );

  const first = data.responses?.[0];
  if (!first || first.error) {
    throw new Error(`vision: ${first?.error?.message ?? "empty response"}`);
  }

  const text = first.fullTextAnnotation?.text ?? "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return { lines, confidence: meanConfidence(first) };
}
