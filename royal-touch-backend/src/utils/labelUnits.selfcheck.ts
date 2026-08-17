/** `npx tsx src/utils/labelUnits.selfcheck.ts` — real values from the warehouse photos. */
import { toMillimetres, parseLabelDate } from "./labelUnits";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfCheck failed: ${msg}`);
}

// Widths exactly as printed by each supplier.
assert(toMillimetres(1250) === 1250, "Schattdecor prints mm");
assert(toMillimetres(124.0) === 1240, "ITC prints 124.00 CM");
assert(toMillimetres(126.0) === 1260, "Interprint prints 126.0 cm");
assert(toMillimetres(1250.0) === 1250, "Magnete prints 1250.00 MM");
assert(toMillimetres(125) === 1250, "KingDecor prints 125 under an mm header, means cm");

// Diameters are always cm on these labels.
assert(toMillimetres(81.0) === 810, "ITC diameter 81cm");
assert(toMillimetres(62) === 620, "LamiGraf diameter 62cm");
assert(toMillimetres(40) === 400, "Interprint roll-Ø 40cm");

// Fractional cm must not leave a fractional mm behind — a 1260.4 would fork materialKey.
assert(Number.isInteger(toMillimetres(126.04)), "result is whole millimetres");

let rejected = false;
try {
  toMillimetres(0);
} catch {
  rejected = true;
}
assert(rejected, "zero width is rejected, not silently stored");

// Every date format seen on a real label.
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
assert(iso(parseLabelDate("18.07.24")) === "2024-07-18", "Interprint two-digit year");
assert(iso(parseLabelDate("22.05.2023")) === "2023-05-22", "Schattdecor");
assert(iso(parseLabelDate("21.04.2025")) === "2025-04-21", "ITC packing date");
assert(iso(parseLabelDate("07.02.2026")) === "2026-02-07", "Magnete");
assert(iso(parseLabelDate("14/05/2026")) === "2026-05-14", "LamiGraf slashes");
assert(iso(parseLabelDate("2026-01-3")) === "2026-01-03", "KingDecor unpadded day");
assert(iso(parseLabelDate("04.06.2024 18:02")) === "2024-06-04", "Olympic with a time");

// Day-first, not month-first: 07.02 is 7 February, not 2 July.
assert(iso(parseLabelDate("07.02.2026")) !== "2026-07-02", "day-first ordering");

// A misread date must not block receiving a roll that is physically on the floor.
assert(parseLabelDate("not a date") === null, "garbage returns null");
assert(parseLabelDate(undefined) === null, "missing returns null");
assert(parseLabelDate("31.02.2025") === null, "31 February rejected, not rolled to March");

console.log("labelUnits selfCheck OK");
