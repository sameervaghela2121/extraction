/**
 * Reads a form-style label by geometry rather than by text order.
 *
 * A roll label is a grid of small captions with their values printed underneath:
 *
 *     Order-no.            Width Paper/Print
 *     919837/10            1270/1250
 *     Roll-no.                          gsm
 *     8004018                            80
 *
 * Flattened to text, "Order-no." and "Width" land on one line and their two values land
 * on the next, so any same-line rule hands the wrong number back — that is exactly how
 * `gsm` came out as 508004018. Matching the value that sits *below* the caption, with
 * horizontal overlap, is the only thing that separates the columns.
 */

export type Word = { text: string; x: number; y: number; w: number; h: number; conf: number };

/** How far below a caption its value may sit, as a multiple of the caption's height.
 *  Two caption-heights covers the gap on a label photographed at an angle without
 *  reaching the row below it. */
const VALUE_SEARCH_DEPTH = 2.8;
/** Fraction of the caption's width that a value must horizontally overlap to count as
 *  belonging to it. Low, because a wide value ("4000432-14-000") often starts left of a
 *  short caption ("Decor-no."). */
const MIN_OVERLAP = 0.15;

const centreX = (word: Word) => word.x + word.w / 2;
const bottom = (word: Word) => word.y + word.h;

function overlapRatio(caption: Word, candidate: Word): number {
  const left = Math.max(caption.x, candidate.x);
  const right = Math.min(caption.x + caption.w, candidate.x + candidate.w);
  const shared = right - left;
  if (shared <= 0) return 0;
  return shared / Math.min(caption.w, candidate.w);
}

/**
 * The value belonging to `caption`: the closest word below it that overlaps horizontally
 * and matches `value`. Falls back to the same word when the caption box itself contains
 * the value (some labels print "GSM 80" together).
 */
export function valueBelow(words: Word[], caption: Word, value: RegExp): string | undefined {
  const inCaption = caption.text.replace(new RegExp(caption.text, "i"), " ").match(value);
  if (inCaption?.[1]) return inCaption[1];

  const maxY = bottom(caption) + caption.h * VALUE_SEARCH_DEPTH;
  // One caption-height of slack above: on a label curved round a roll the rows tilt, so
  // a value box can start marginally higher than the caption it belongs to. Measured on
  // a real photo: "Width" at y=1055, its value "1270/1250" at y=1048.
  const minY = caption.y - caption.h;
  const candidates = words
    .filter((w) => w !== caption && w.y >= minY && w.y <= maxY)
    .filter((w) => overlapRatio(caption, w) >= MIN_OVERLAP)
    // Nearest first, then leftmost — a value directly under the caption beats one that
    // merely clips its right edge.
    .sort(
      (a, b) =>
        a.y - b.y ||
        Math.abs(centreX(a) - centreX(caption)) - Math.abs(centreX(b) - centreX(caption)),
    );

  for (const candidate of candidates) {
    const match = candidate.text.match(value);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** First word whose text matches `caption`, searched top-to-bottom. */
export function findCaption(words: Word[], caption: RegExp): Word | undefined {
  return [...words].sort((a, b) => a.y - b.y).find((w) => caption.test(w.text.toUpperCase()));
}

/** Caption lookup plus value extraction in one step. */
export function fieldByLayout(
  words: Word[],
  caption: RegExp,
  value: RegExp,
): string | undefined {
  const found = findCaption(words, caption);
  return found ? valueBelow(words, found, value) : undefined;
}
