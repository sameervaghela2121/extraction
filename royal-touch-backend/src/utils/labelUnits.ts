/**
 * Normalisers for values read off supplier labels.
 *
 * Six suppliers, six conventions. Nothing downstream should ever have to ask which unit a
 * number is in, so everything is converted at this boundary: widths and diameters to mm,
 * dates to Date.
 */

/**
 * Below this, a roll width can only be centimetres — decor paper runs roughly 1200-1600mm
 * (120-160cm), and no roll is 126mm wide.
 *
 * ponytail: a threshold, not a units parser, because the labels cannot be trusted to say.
 * ITC and Interprint print "124.00 CM" and "126.0 cm" honestly; KingDecor prints "125"
 * under a header reading mm while meaning cm. Raise this only if a genuinely narrow
 * material is ever stocked.
 */
const CM_THRESHOLD_MM = 500;

/** Width or diameter as printed → millimetres, whatever unit the label used. */
export function toMillimetres(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Not a usable measurement: ${value}`);
  }
  return value < CM_THRESHOLD_MM ? Math.round(value * 10) : Math.round(value);
}

/**
 * Parses the date formats seen on real labels:
 *   18.07.24            Interprint, two-digit year
 *   22.05.2023          Schattdecor
 *   21.04.2025          ITC
 *   07.02.2026          Magnete
 *   14/05/2026          LamiGraf
 *   2026-01-3           KingDecor, unpadded day
 *   04.06.2024 18:02    Olympic, with a time
 *
 * Day-first is assumed for dotted and slashed forms — every supplier here is European or
 * Indian, and none uses US month-first ordering. Returns null rather than throwing: a
 * misread production date must not block receiving a roll that is physically present.
 */
export function parseLabelDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const text = input.trim();

  // ISO-ish first: 2026-01-3 / 2026-01-03
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Day-first, dot or slash separated, optional trailing time.
  // Four-digit year listed first: regex alternation takes the leftmost match, so
  // (\d{2}|\d{4}) would read "2023" as the year 20. The lookahead stops \d{4} from
  // grabbing part of a longer run.
  const dmy = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/);
  if (dmy) {
    const year = Number(dmy[3]);
    // A two-digit year on a production label is this century — these are rolls in a
    // warehouse now, not archive stock from 1924.
    return build(year < 100 ? 2000 + year : year, Number(dmy[2]), Number(dmy[1]));
  }

  return null;
}

function build(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // UTC so a roll produced on the 1st never reads as the 31st in another timezone.
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible days that Date would silently roll forward (31 Feb → 3 Mar).
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
