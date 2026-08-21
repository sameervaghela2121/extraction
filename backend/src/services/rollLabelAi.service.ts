import { invoiceGeneratorClient } from "./invoiceGeneratorClient.service";
import { matchMasters, type MasterMatch } from "./labelMatch.service";
import { ApiError } from "../utils/ApiError";

/**
 * Roll label reading through the extraction service's Gemini route.
 *
 * The other readers OCR the photo into text and this side works out which value belongs
 * to which caption by pixel geometry. That parser is fitted to the label layouts we had
 * to hand, so a supplier whose label we have never seen reads the wrong column. Here the
 * model is asked for the fields directly and there is nothing on this side to fit.
 *
 * Its own module rather than another engine inside ocr.service for one reason: that
 * service's engines all return {lines, words} and share one parser. This one returns
 * fields and skips the parser entirely, so folding it in would mean two code paths
 * pretending to be one.
 */

/** Below this the read is not worth pre-filling a form with. Same floor the OCR reader
 *  uses, so "reliable" means the same thing on every route. */
const MIN_RELIABLE_CONFIDENCE = 0.7;

/** Mirrors ocr.service's RollLabelFields so the response is drop-in, but declared here
 *  rather than imported: this route must not be able to change that module. */
export type AiRollLabelFields = {
  roll_number: string | null;
  gsm: number | null;
  width_mm: number | null;
  weight_kg: number | null;
  batch_no: string | null;
  material: MasterMatch;
  vendor: MasterMatch;
  confidence: number;
  engine: "gemini";
  reliable: boolean;
  message: string | null;
  raw_text: string;
};

const UNREADABLE =
  "The label could not be read clearly — enter the details manually, or retake the photo square-on to the label in good light.";

export const rollLabelAiService = {
  async readRollLabel(image: Buffer): Promise<AiRollLabelFields> {
    const read = await invoiceGeneratorClient.readRollLabelAi(image);

    if (!read.raw_text.trim()) {
      throw ApiError.badRequest(
        "No readable text found — retake the photo closer and in better light",
      );
    }

    const fields = {
      roll_number: read.roll_number,
      gsm: read.gsm,
      width_mm: read.width_mm,
      weight_kg: read.weight_kg,
      batch_no: read.batch_no,
    };

    const found = Object.values(fields).filter((v) => v !== null).length;
    const reliable = read.confidence >= MIN_RELIABLE_CONFIDENCE && found > 0;

    // A read we do not trust returns nothing rather than something. Pre-filling a form
    // with values that are probably wrong is worse than leaving it blank: the operator
    // was going to type them anyway, and a wrong number gets accepted without checking.
    if (!reliable) {
      return {
        roll_number: null,
        gsm: null,
        width_mm: null,
        weight_kg: null,
        batch_no: null,
        material: null,
        vendor: null,
        confidence: read.confidence,
        engine: "gemini",
        reliable: false,
        message: UNREADABLE,
        raw_text: read.raw_text,
      };
    }

    // Only looked up on a read we trust — matching against garbage risks landing on a
    // real master record by accident.
    const { material, vendor } = await matchMasters(read.raw_text.split("\n"), fields);

    return {
      ...fields,
      material,
      vendor,
      confidence: read.confidence,
      engine: "gemini",
      reliable: true,
      message: null,
      raw_text: read.raw_text,
    };
  },
};
