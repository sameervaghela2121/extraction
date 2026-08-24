import { RawMaterial } from "../models/RawMaterial.model";
import { Vendor } from "../models/Vendor.model";

/**
 * Resolve the names printed on a label to records in our masters.
 *
 * OCR gives text; the roll form needs ids. A label says "schattdecor" and "Golden Veins",
 * never a Mongo ObjectId, so the only way to pre-fill material_id / vendor_id is to look
 * the printed text up. Anything that does not match exactly one active record comes back
 * null — a wrong id is far worse than an empty field, because it silently files stock
 * against the wrong material.
 *
 * Matching runs in memory rather than as a Mongo query: both masters are small (that is
 * why their list endpoints are unpaginated), and comparing normalised strings in JS is
 * simpler than building a text index for a few hundred rows.
 */

export type MasterMatch = { id: string; name: string; code: string; matched_on: string } | null;

/** Lowercase, strip everything but letters and digits: "NEW-IVORY" and "new ivory" are
 *  the same label to a human and should be to us too. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A code is a match only as a whole token — "PP-80" must not match inside "PP-800". */
function containsToken(haystackTokens: Set<string>, needle: string): boolean {
  return haystackTokens.has(needle);
}

/** Edit distance, abandoned once it exceeds `limit` — we only care about near-misses. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowBest = Math.min(rowBest, current[j]);
    }
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** How far a printed name may be misread and still count as the same name. Two edits on
 *  a six-character name: "schattdeca" for "schattdecor" is a real OCR result, "acme" vs
 *  "acne" is not something we want to guess at, which is why short names are excluded. */
const MAX_NAME_EDITS = 2;
const MIN_FUZZY_LENGTH = 6;

/**
 * The one record whose name is within a couple of misread characters of a token on the
 * label. Ambiguity loses: if two records are equally close, neither is returned, because
 * filing stock against the wrong master is worse than filling the field in by hand.
 */
function fuzzyByName<T extends { name: string }>(records: T[], tokens: Set<string>): T | undefined {
  let best: { record: T; distance: number } | undefined;
  let tied = false;

  for (const record of records) {
    const name = normalise(record.name);
    if (name.length < MIN_FUZZY_LENGTH) continue;
    for (const token of tokens) {
      if (token.length < MIN_FUZZY_LENGTH) continue;
      const distance = editDistance(name, token, MAX_NAME_EDITS);
      if (distance > MAX_NAME_EDITS) continue;
      if (!best || distance < best.distance) {
        best = { record, distance };
        tied = false;
      } else if (distance === best.distance && best.record !== record) {
        tied = true;
      }
    }
  }
  return best && !tied ? best.record : undefined;
}

export async function matchMasters(
  lines: string[],
  fields: { gsm: number | null; width: number | null },
): Promise<{ material: MasterMatch; vendor: MasterMatch }> {
  const text = normalise(lines.join(" "));
  const tokens = new Set(lines.flatMap((l) => l.split(/\s+/)).map(normalise).filter(Boolean));

  const [materials, vendors] = await Promise.all([
    RawMaterial.find({ status: "active" }).select("name material_code gsm width_mm").lean(),
    Vendor.find({ status: "active" }).select("name vendor_code").lean(),
  ]);

  let vendorHit = vendors.find((v) => containsToken(tokens, normalise(v.vendor_code)));
  let vendorMatchedOn = "vendor_code";
  if (!vendorHit) {
    vendorHit = vendors.find((v) => normalise(v.name).length >= 4 && text.includes(normalise(v.name)));
    vendorMatchedOn = "name";
  }
  if (!vendorHit) {
    // A manufacturer's name is usually the logo on the label, which is the text OCR reads
    // worst — "schattdeca" for "Schattdecor" is typical.
    vendorHit = fuzzyByName(vendors, tokens);
    vendorMatchedOn = "name_fuzzy";
  }

  const vendor: MasterMatch = vendorHit
    ? {
        id: vendorHit._id.toString(),
        name: vendorHit.name,
        code: vendorHit.vendor_code,
        matched_on: vendorMatchedOn,
      }
    : null;

  // Code first, then name, then specification. Specification only counts when it picks
  // out exactly one material — two materials at 80gsm/1600mm tell us nothing.
  let materialHit = materials.find((m) => containsToken(tokens, normalise(m.material_code)));
  let matchedOn = "material_code";

  if (!materialHit) {
    materialHit = materials.find((m) => normalise(m.name).length >= 4 && text.includes(normalise(m.name)));
    matchedOn = "name";
  }
  if (!materialHit) {
    materialHit = fuzzyByName(materials, tokens);
    matchedOn = "name_fuzzy";
  }
  if (!materialHit && fields.gsm !== null && fields.width !== null) {
    const bySpec = materials.filter((m) => m.gsm === fields.gsm && m.width_mm === fields.width);
    if (bySpec.length === 1) {
      materialHit = bySpec[0];
      matchedOn = "gsm_and_width";
    }
  }

  const material: MasterMatch = materialHit
    ? {
        id: materialHit._id.toString(),
        name: materialHit.name,
        code: materialHit.material_code,
        matched_on: matchedOn,
      }
    : null;

  return { material, vendor };
}
