import { invoiceGeneratorClient } from "./invoiceGeneratorClient.service";
import { matchMasters, type MasterMatch } from "./labelMatch.service";
import { ApiError } from "../utils/ApiError";

/**
 * Roll label reading through the extraction service's Gemini route — the only reader.
 *
 * The engines this replaced (easyocr, Google Vision, tesseract) OCR'd the photo into text
 * and this side worked out which value belonged to which caption by pixel geometry. That
 * parser was fitted to the label layouts we had to hand, so a supplier whose label we had
 * never seen read the wrong column. Here the model is asked for the fields directly and
 * there is nothing on this side to fit.
 */

/** Below this the read is not worth pre-filling a form with. */
const MIN_RELIABLE_CONFIDENCE = 0.7;

/** The shape the app fills its add-roll form from. Field names match POST /material-rolls
 *  exactly, so a reliable read can be posted through unchanged. */
export type AiRollLabelFields = {
  roll_number: string | null;
  gsm: number | null;
  width: number | null;
  weight: number | null;
  date: string | null;
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
      width: read.width,
      weight: read.weight,
      date: read.date,
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
        width: null,
        weight: null,
        date: null,
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
