import { spawn } from "child_process";
import axios from "axios";
import sharp from "sharp";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { isVisionConfigured, readWithVision } from "./visionOcr.service";
import { invoiceGeneratorClient } from "./invoiceGeneratorClient.service";
import { env } from "../config/env";
import { fieldByLayout, type Word as LabelWord } from "./labelLayout";
import { matchMasters, type MasterMatch } from "./labelMatch.service";

/** Pipe the image straight into tesseract's stdin and read TSV back off stdout — no
 *  temp file to name, collide on, or forget to delete. */
function runTesseract(image: Buffer, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tesseract", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`tesseract timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`tesseract exited ${code}: ${stderr.trim()}`));
    });

    proc.stdin.on("error", () => {
      /* tesseract closed the pipe early; the close handler reports the real reason */
    });
    proc.stdin.end(image);
  });
}

// A phone photo is the worst case for OCR: soft focus, uneven light, a label filling a
// third of the frame. Upscaling, greyscale and a hard threshold do more for accuracy
// here than any tesseract flag.
const TARGET_WIDTH = 2000;
const OCR_TIMEOUT_MS = 20_000;
// Two page-segmentation modes, because which one wins depends on the photo and there is
// no way to tell in advance: 6 ("one uniform block") suits a flat label shot square-on,
// 11 ("sparse text") copes far better with a label curved around a roll, where the lines
// are arcs. Measured on a real roll photo: psm 6 scored 29, psm 11 scored 50. Both run,
// the higher-confidence read wins.
const TESSERACT_PSMS = ["6", "11"] as const;
const tesseractArgs = (psm: string) => ["stdin", "stdout", "--psm", psm, "tsv"];

export type RollLabelFields = {
  roll_number: string | null;
  gsm: number | null;
  width_mm: number | null;
  weight_kg: number | null;
  batch_no: string | null;
  /** The label's material and vendor resolved against our masters — null when nothing
   *  matched, so the form shows an empty picker rather than a wrong id. */
  material: MasterMatch;
  vendor: MasterMatch;
  confidence: number;
  /** Which engine produced this, so a bad read can be traced to the right place. */
  engine: OcrEngine;
  /** False when the read was too poor to trust. The app must leave the form blank for
   *  the user to type rather than pre-filling values that are probably wrong. */
  reliable: boolean;
  message: string | null;
  raw_text: string;
};

export type OcrEngine = "easyocr" | "vision" | "tesseract";

/**
 * Engines are tried in order and the first that answers wins; a failure falls through to
 * the next rather than failing the request, so a roll can always be registered.
 *
 * easyocr first because it is the only one that reads a label wrapped around a roll
 * (measured on a real photo: 6/6 fields, against 0/6 for tesseract). It is local and
 * free but slow, so tesseract stays as the last resort — instant, and fine on a flat
 * label shot square-on.
 */
function engineOrder(): OcrEngine[] {
  const configured = env.ocrEngine as OcrEngine | "auto";
  if (configured !== "auto") return [configured];
  return ["easyocr", ...(isVisionConfigured() ? (["vision"] as const) : []), "tesseract"];
}

// Below this, tesseract is guessing. Measured on real roll photos: a flat printed label
// scores ~0.90, a curved or dirty one ~0.30 with digits transposed. Pre-filling a form
// from the second kind puts wrong numbers in front of the operator, which is worse than
// an empty field they were going to fill in anyway.
const MIN_RELIABLE_CONFIDENCE = 0.7;

type Word = { key: string; order: number[]; text: string; conf: number };

async function preprocess(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate() // honour the EXIF orientation a phone camera writes
    .resize({ width: TARGET_WIDTH, withoutEnlargement: false })
    .greyscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
}

/** Tesseract's TSV output: one row per word with its line number and confidence. */
function parseTsv(tsv: string): Word[] {
  const words: Word[] = [];
  for (const row of tsv.split("\n").slice(1)) {
    const cols = row.split("\t");
    if (cols.length < 12) continue;
    const text = cols[11]?.trim();
    const conf = Number(cols[10]);
    // -1 confidence marks a layout row (block/paragraph/line), not a recognised word.
    if (!text || !Number.isFinite(conf) || conf < 0) continue;
    // block/paragraph/line together identify a line; line_num alone restarts per block,
    // so two unrelated lines would otherwise be concatenated.
    const order = [Number(cols[2]), Number(cols[3]), Number(cols[4])];
    words.push({ key: order.join("."), order, text, conf });
  }
  return words;
}

function toLines(words: Word[]): string[] {
  const byLine = new Map<string, { order: number[]; parts: string[] }>();
  for (const w of words) {
    const bucket = byLine.get(w.key) ?? { order: w.order, parts: [] };
    bucket.parts.push(w.text);
    byLine.set(w.key, bucket);
  }
  return [...byLine.values()]
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2])
    .map((l) => l.parts.join(" "));
}

/** OCR reads 0/O and 1/I/l interchangeably. In a field we already know is numeric,
 *  the digit is always the right bet. */
function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[OoQ]/g, "0").replace(/[IlL|]/g, "1").replace(/[^\d.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && digits !== "" ? n : null;
}

/**
 * Try each pattern against each line, in pattern order. Line by line rather than over the
 * whole text: `\s` matches newlines, so "80 GSM" followed by "1600 MM" on the next line
 * would otherwise let the GSM pattern reach across and capture 1600. Every pattern below
 * therefore uses [ \t]* for gaps, never \s*.
 */
function firstMatch(lines: string[], patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    for (const line of lines) {
      const m = line.match(pattern);
      if (m?.[1]) return m[1];
    }
  }
  return undefined;
}

/**
 * Real labels are tables: a small caption ("gsm", "gross weight (kg)", "Roll-no.") with
 * the value printed *underneath* it, not beside it. So each field is looked for in three
 * places, in order — same line as the caption, the line below, then two lines below —
 * and only within that window, never across the whole text.
 */
function valueNearCaption(
  lines: string[],
  caption: RegExp,
  value: RegExp,
  lookahead = 2,
): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!caption.test(lines[i])) continue;
    // Strip the caption itself before looking, or "Width Paper/Print" would offer its
    // own digits to a numeric pattern.
    const sameLine = lines[i].replace(caption, " ").match(value);
    if (sameLine?.[1]) return sameLine[1];
    for (let step = 1; step <= lookahead && i + step < lines.length; step++) {
      const below = lines[i + step].match(value);
      if (below?.[1]) return below[1];
    }
  }
  return undefined;
}

/**
 * Label fields, read off the flattened text. Each field has several patterns because
 * labels vary — "GSM 80", "80 GSM" and "GSM: 80" all appear in the wild — and the first
 * one that hits wins. A field nothing matches comes back null rather than guessed.
 */
type ParsedFields = Pick<
  RollLabelFields,
  "roll_number" | "gsm" | "width_mm" | "weight_kg" | "batch_no"
>;

/** Captions as they are printed on a roll label, and the shape of the value under each. */
const LAYOUT = {
  roll_number: [/^ROLL[\s\-\u2014_]*NO/i, /(\d{6,12})/],
  gsm: [/^GSM$/i, /^(\d{2,4})$/],
  // "1270/1250" is paper/print width. Anchored to exactly 3-4 digits before the slash so
  // it cannot match the order number "919837/10" sitting in the neighbouring column.
  width_mm: [/^WIDTH/i, /^(\d{3,4})\/\d{2,4}$/],
  weight_kg: [/WEIGHT/i, /^(\d{1,5}(?:[.,]\d+)?)$/],
  batch_no: [/^(?:DECOR|BATCH|LOT)[\s\-\u2014_]*NO/i, /^([A-Z0-9][A-Z0-9\-\/]{3,})$/i],
} as const;

function parseFields(rawLines: string[], words?: LabelWord[]): ParsedFields {
  const upper = rawLines.map((l) => l.toUpperCase());

  // Geometry wins where it is available: it is the only way to tell two side-by-side
  // columns apart. Text patterns stay as the fallback for engines that return no boxes.
  const byLayout = (field: keyof typeof LAYOUT): string | undefined => {
    if (!words || words.length === 0) return undefined;
    const [caption, value] = LAYOUT[field];
    return fieldByLayout(words, caption, value);
  };

  const NUM = /([\dOoIl][\dOoIl.,\/\-]{0,9})/;
  const CODE = /((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{3,})/;

  const rollNumber =
    byLayout("roll_number") ??
    valueNearCaption(upper, /ROLL[ \t]*[-\u2014]?[ \t]*NO\.?/, /\b(?:D[O0]{2})?[ \t]*(\d{6,12})\b/) ??
    firstMatch(upper, [
      // The lookahead forces at least one digit into the capture, so the "ROLL" in
      // "WHITE PAPER ROLL" can't swallow the next word as an identifier.
      /ROLL[ \t]*(?:NO|NUM(?:BER)?|#)[ \t]*[:.\-]?[ \t]*((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{3,})/,
      /ROLL[ \t]*[:.\-][ \t]*((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{3,})/,
      /\b(RL[-\s]?\d{2,4}[-\s]?\d{3,})\b/,
      // A bare long run of digits is how the printed barcode number appears.
      /\b(\d{10,20})\b/,
    ])?.replace(/\s+/g, "") ?? null;

  const batch =
    byLayout("batch_no") ??
    valueNearCaption(upper, /DEC[O0]R[ \t]*[-\u2014]?[ \t]*NO\.?/, CODE) ??
    valueNearCaption(upper, /ORDER[ \t]*[-\u2014]?[ \t]*NO\.?/, CODE) ??
    firstMatch(upper, [
      /BATCH[ \t]*(?:NO|#)?[ \t]*[:.\-]?[ \t]*((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{1,})/,
      /\bLOT[ \t]*[:.\-]?[ \t]*((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{1,})/,
    ])?.replace(/\s+/g, "") ?? null;

  return {
    roll_number: rollNumber,
    gsm: toNumber(
      byLayout("gsm") ??
        valueNearCaption(upper, /\bGSM\b/, NUM) ??
        firstMatch(upper, [/GSM[ \t]*[:.\-]?[ \t]*([\dOoIl.]{2,5})/, /([\dOoIl.]{2,5})[ \t]*GSM/]),
    ),
    width_mm: toNumber(
      byLayout("width_mm") ??
      // "Width Paper/Print  1270/1250" — the paper width is the first of the pair.
      valueNearCaption(upper, /WIDTH[ \t]*(?:PAPER)?[ \t]*\/?[ \t]*(?:PRINT)?/, /(\d{3,4})[ \t]*\/?/) ??
        firstMatch(upper, [
        /WIDTH[ \t]*(?:MM)?[ \t]*[:.\-]?[ \t]*([\dOoIl.]{3,5})/,
        /([\dOoIl.]{3,5})[ \t]*MM\b/,
        /\bW[ \t]*[:.\-][ \t]*([\dOoIl.]{3,5})/,
      ]),
    ),
    weight_kg: toNumber(
      byLayout("weight_kg") ??
      valueNearCaption(upper, /(?:GROSS[ \t]*)?WEIGHT[ \t]*\(?KG\)?/, NUM) ??
        firstMatch(upper, [
        /(?:NET[ \t]*WT|WEIGHT|WT|NET)[ \t]*[:.\-]?[ \t]*([\dOoIl.]{1,7})[ \t]*(?:KGS?)?/,
        /([\dOoIl.]{1,7})[ \t]*KGS?\b/,
      ]),
    ),
    batch_no: batch,
  };
}

async function readWithTesseract(image: Buffer): Promise<{ lines: string[]; confidence: number }> {
  const prepared = await preprocess(image).catch(() => {
    throw ApiError.badRequest("That file could not be read as an image");
  });

  let attempts: Array<{ lines: string[]; confidence: number }>;
  try {
    attempts = await Promise.all(
      TESSERACT_PSMS.map(async (psm) => {
        const words = parseTsv(await runTesseract(prepared, tesseractArgs(psm), OCR_TIMEOUT_MS));
        return {
          lines: toLines(words),
          confidence: words.length
            ? Math.round((words.reduce((sum, w) => sum + w.conf, 0) / words.length) * 10) / 1000
            : 0,
        };
      }),
    );
  } catch (err) {
    logger.error("[ocr] tesseract failed", err);
    throw new ApiError(503, "Text recognition is unavailable right now. Please try again.");
  }

  return attempts.reduce((best, attempt) => (attempt.confidence > best.confidence ? attempt : best));
}

export type EngineRead = { lines: string[]; confidence: number; words?: LabelWord[] };

function runEngine(engine: OcrEngine, image: Buffer): Promise<EngineRead> {
  if (engine === "easyocr") return invoiceGeneratorClient.readRollLabel(image);
  if (engine === "vision") return readWithVision(image);
  return readWithTesseract(image);
}

export const ocrService = {
  /** Read a roll label photo. Fields it can't find come back null — never invented. */
  async readRollLabel(image: Buffer): Promise<RollLabelFields> {
    const order = engineOrder();
    let engine: OcrEngine = order[order.length - 1];
    let read: EngineRead | undefined;

    for (const candidate of order) {
      try {
        read = await runEngine(candidate, image);
        engine = candidate;
        break;
      } catch (err) {
        const last = candidate === order[order.length - 1];
        // Only the message and status are logged — an axios error carries the whole
        // request config, including credentials, and that must never reach the log.
        logger.error(
          `[ocr] ${candidate} failed${last ? "" : ", trying the next engine"}:`,
          axios.isAxiosError(err)
            ? `${err.response?.status ?? "no response"} ${err.message}`
            : (err as Error).message,
        );
        if (last) throw err;
      }
    }

    const { lines, confidence, words } = read!;
    if (lines.length === 0) {
      throw ApiError.badRequest("No readable text found — retake the photo closer and in better light");
    }
    const raw_text = lines.join("\n");

    const fields = parseFields(lines, words);
    const found = Object.values(fields).filter((v) => v !== null).length;
    const reliable = confidence >= MIN_RELIABLE_CONFIDENCE && found > 0;

    if (!reliable) {
      return {
        roll_number: null,
        gsm: null,
        width_mm: null,
        weight_kg: null,
        batch_no: null,
        material: null,
        vendor: null,
        confidence,
        engine,
        reliable: false,
        message:
          "The label could not be read clearly — enter the details manually, or retake the photo square-on to the label in good light.",
        raw_text,
      };
    }

    // Only looked up on a read we trust — matching against garbage text risks landing on
    // a real record by accident.
    const { material, vendor } = await matchMasters(lines, fields);

    return { ...fields, material, vendor, confidence, engine, reliable: true, message: null, raw_text };
  },
};
