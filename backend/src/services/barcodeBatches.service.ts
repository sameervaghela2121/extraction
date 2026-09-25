import { Types } from "mongoose";
import { BarcodeBatch, type IBarcodeBatch } from "../models/BarcodeBatch.model";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { escapeRegex, findOr404 } from "../utils/crud";
import { ApiError } from "../utils/ApiError";
import type { AuthPayload } from "../types/express";

const DEFAULT_PAGE_SIZE = 20;

type BatchInput = {
  prefix: string;
  date: string;
  from_number: number;
  to_number: number;
  kind: "barcode" | "qr";
  widthMm: number;
  heightMm: number;
};

function toResponse(b: IBarcodeBatch & { createdBy?: unknown }) {
  const creator = b.createdBy as { name?: string } | Types.ObjectId | null;
  // Runs saved before this field existed have none in the database — default each to that
  // kind's own long-standing default rather than one fixed guess, so an old QR run doesn't
  // come back thinking it was made on a wide barcode-shaped label.
  const kind = b.kind ?? "barcode";
  const defaultWidthMm = kind === "qr" ? 40 : 100;
  const defaultHeightMm = kind === "qr" ? 40 : 50;
  return {
    id: b._id.toString(),
    prefix: b.prefix,
    date: b.date,
    from_number: b.from_number,
    to_number: b.to_number,
    kind,
    widthMm: b.widthMm ?? defaultWidthMm,
    heightMm: b.heightMm ?? defaultHeightMm,
    count: b.to_number - b.from_number + 1,
    createdBy: creator && "name" in creator ? (creator.name ?? "—") : "—",
    createdAt: b.createdAt,
  };
}

/** "2026-09-07" → "260907" — the backend's copy of series.ts's dateDigits, kept in step
 *  with it deliberately rather than shared: this is the one place outside the frontend a
 *  run's own code recipe needs reconstructing, and importing frontend code into the
 *  backend isn't a real option. */
function dateDigits(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1].slice(2)}${match[2]}${match[3]}` : "";
}

/** Same width rule as series.ts's seriesCode: at least 3 digits, or however many the
 *  largest number in the run actually needs. */
function codeWidth(batch: Pick<IBarcodeBatch, "from_number" | "to_number">): number {
  return Math.max(3, String(Math.max(batch.from_number, batch.to_number)).length);
}

/**
 * An exact code (read off a roll's own `barcode` field, which is always a complete code
 * someone actually scanned in) → the run that made it and which number in that run it is
 * — or null if it matches no saved run's own prefix, date and range.
 *
 * Checked against every run's own recipe rather than expanding each run's full range: a
 * run's numbers are recreated one at a time by prefix + date digits + a fixed-width
 * number, so testing "does this code fit this run's shape" is one string compare and one
 * range check, not up to 500 per run.
 */
function resolveExactCode(
  batches: IBarcodeBatch[],
  rawCode: string,
): { batch: IBarcodeBatch; number: number } | null {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;
  for (const batch of batches) {
    const head = `${batch.prefix}${dateDigits(batch.date)}`.toUpperCase();
    if (!code.startsWith(head)) continue;
    const rest = code.slice(head.length);
    if (rest.length !== codeWidth(batch) || !/^\d+$/.test(rest)) continue;
    const n = Number(rest);
    if (n >= batch.from_number && n <= batch.to_number) return { batch, number: n };
  }
  return null;
}

/** Enough for one screen of results — the box above the list, not a report. */
const MAX_SEARCH_RESULTS = 50;

/**
 * Every code, across every run, that *contains* this text — a partial search, not an
 * exact one, so "24003", "2609" or even one digit all turn up something rather than
 * nothing.
 *
 * Brute-forced one number at a time within each run's own range rather than reasoned
 * about algebraically: a typed fragment can land inside the prefix, the date or the
 * number, or straddle two of them, and no run is large enough (500 labels, at most) for
 * scanning its whole range to be worth avoiding.
 */
function findCodesContaining(
  batches: IBarcodeBatch[],
  text: string,
  limit: number = MAX_SEARCH_RESULTS,
): Array<{ batch: IBarcodeBatch; number: number; code: string }> {
  const needle = text.trim().toUpperCase();
  if (!needle) return [];
  const hits: Array<{ batch: IBarcodeBatch; number: number; code: string }> = [];
  for (const batch of batches) {
    const width = codeWidth(batch);
    const head = `${batch.prefix}${dateDigits(batch.date)}`.toUpperCase();
    for (let n = batch.from_number; n <= batch.to_number; n++) {
      const code = `${head}${String(n).padStart(width, "0")}`;
      if (code.includes(needle)) {
        hits.push({ batch, number: n, code });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

export const barcodeBatchesService = {
  async list(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const [items, total] = await Promise.all([
      BarcodeBatch.find({ deleted_at: null })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("createdBy", "name")
        .lean<IBarcodeBatch[]>(),
      BarcodeBatch.countDocuments({ deleted_at: null }),
    ]);
    return {
      items: items.map(toResponse),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  /**
   * The global search on the barcode screen: any part of a code, a roll number, or a
   * Royal Touche paper code, resolved to whichever run(s) it belongs to.
   *
   * Every hit is a single code, not a whole run — searching "AJ123" (a roll number) or
   * "638" (a royal_touche_code several rolls can share) is about one physical sticker or
   * a handful of them, never "show me the batch this happened to be printed in." Partial
   * on every field: a single character is enough to turn up something, same as it already
   * was for a roll number or paper code.
   */
  async search(q: string) {
    const query = q.trim();
    if (!query) return { items: [] };

    type Result = {
      code: string;
      batch: IBarcodeBatch;
      roll?: { roll_number: string; royal_touche_code?: string };
    };
    const results: Result[] = [];
    // batchId:number — the same run/number can be reached two ways (typed directly, and
    // again through a roll that carries it), and it should only appear once.
    const seen = new Set<string>();
    const add = (
      resolved: { batch: IBarcodeBatch; number: number } | null,
      code: string,
      roll?: Result["roll"],
    ) => {
      if (!resolved) return;
      const key = `${resolved.batch._id.toString()}:${resolved.number}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ code, batch: resolved.batch, roll });
    };

    // Fetched once and reused for both passes below — every run's own recipe, not its
    // codes, so this is cheap regardless of how many labels each one covers.
    const batches = await BarcodeBatch.find({ deleted_at: null }).lean<IBarcodeBatch[]>();

    // Whatever's typed or scanned, matched against any part of any run's codes.
    for (const hit of findCodesContaining(batches, query)) {
      add({ batch: hit.batch, number: hit.number }, hit.code);
    }

    // A roll number, or a paper code several rolls can share — either way, reached through
    // the roll's own printed barcode field (an exact code, since it's what was actually
    // scanned in), not the roll record itself.
    const rx = new RegExp(escapeRegex(query), "i");
    const rolls = await MaterialRoll.find({
      $or: [{ roll_number: rx }, { royal_touche_code: rx }],
      barcode: { $exists: true, $ne: "" },
    })
      .select("roll_number royal_touche_code barcode")
      .limit(MAX_SEARCH_RESULTS)
      .lean();
    for (const roll of rolls) {
      if (!roll.barcode) continue;
      add(resolveExactCode(batches, roll.barcode), roll.barcode.toUpperCase(), {
        roll_number: roll.roll_number,
        royal_touche_code: roll.royal_touche_code,
      });
    }

    return { items: results.map((r) => ({ code: r.code, batch: toResponse(r.batch), roll: r.roll })) };
  },

  /**
   * Where the next run for this prefix and date should start.
   *
   * A code is prefix + YYMMDD + sequence, so a number only has to be unique within one
   * prefix on one date — which is exactly what is filtered here.
   *
   * Deleted runs count. Their labels were printed and are on rolls somewhere, so the
   * counter must never rewind past them. This is also why the client no longer works this
   * out from the runs it happens to have loaded: that list is paginated and hides removed
   * runs, so it could only ever see part of the answer.
   */
  async nextNumber(prefix: string, date: string) {
    const highest = await BarcodeBatch.findOne({
      prefix: prefix.trim().toUpperCase(),
      date: date.trim(),
    })
      .sort({ to_number: -1 })
      .select("to_number")
      .lean();
    return { next: (highest?.to_number ?? 0) + 1 };
  },

  async create(input: BatchInput, auth: AuthPayload) {
    // Normalise here, not just in the schema: the duplicate check is a query, and it has
    // to compare against the same shape the unique index stores. Kind is deliberately left
    // out — the same number range must stay unique no matter which kind it's saved as, since
    // it's the physical numbers already spent that matter, not how they were rendered.
    const values = {
      prefix: input.prefix.trim().toUpperCase(),
      date: input.date.trim(),
      from_number: input.from_number,
      to_number: input.to_number,
    };
    const duplicate = "That exact run has already been saved";
    if (await BarcodeBatch.exists(values)) throw ApiError.conflict(duplicate);
    try {
      const batch = await BarcodeBatch.create({
        ...values,
        kind: input.kind,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        createdBy: new Types.ObjectId(auth.userId),
      });
      // Populate before responding: the list shows a name, and a freshly created row
      // would otherwise sit there as "—" until the page is reloaded.
      await batch.populate("createdBy", "name");
      return toResponse(batch);
    } catch (err) {
      // Two clicks landing together: the check above passes twice, the index rejects one.
      if ((err as { code?: number }).code === 11000) throw ApiError.conflict(duplicate);
      throw err;
    }
  },

  /**
   * Soft, and deliberately so.
   *
   * The row is a record of numbers that were physically printed. Removing it used to let
   * nextNumber hand those same codes out again — two rolls carrying one barcode, which is
   * unrecoverable once they are in the godown. The run leaves the list; the numbers stay
   * spent.
   */
  async remove(id: string) {
    const batch = await findOr404(BarcodeBatch, id, "barcode batch");
    if (!batch.deleted_at) {
      batch.deleted_at = new Date();
      await batch.save();
    }
    return { id };
  },
};
