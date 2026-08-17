/** `npx tsx src/utils/materialKey.selfcheck.ts` — no DB, no server needed. */
import { buildMaterialKey } from "./materialKey";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfCheck failed: ${msg}`);
}

// Real values off the labels photographed in the warehouse.
const schattdecor = buildMaterialKey({
  supplierCode: "SCHATT",
  designCode: "14-50085-100",
  widthMm: 1250,
  gsm: 70,
});
assert(schattdecor === "SCHATT|14-50085-100|1250|70", "schattdecor lamella");

// ITC white base paper: no design code at all. The empty segment must still produce a
// stable key, and two ITC papers differing only in gsm must not collide.
const itc50 = buildMaterialKey({ supplierCode: "ITC", widthMm: 1240, gsm: 50 });
const itc70 = buildMaterialKey({ supplierCode: "ITC", widthMm: 1240, gsm: 70 });
assert(itc50 === "ITC||1240|50", "itc without design code");
assert(itc50 !== itc70, "same width, different gsm are different materials");

// Same design at a different width is a different material.
const wide = buildMaterialKey({ supplierCode: "SCHATT", designCode: "14-50085-100", widthMm: 1600, gsm: 70 });
assert(wide !== schattdecor, "width is part of identity");

// null and undefined design codes behave identically to absent.
assert(
  buildMaterialKey({ supplierCode: "ITC", designCode: null, widthMm: 1240, gsm: 50 }) === itc50,
  "null design code",
);

// Case and stray whitespace come from manual entry; they must not fork the key.
assert(
  buildMaterialKey({ supplierCode: " schatt ", designCode: " 14-50085-100 ", widthMm: 1250, gsm: 70 }) ===
    schattdecor,
  "case and whitespace normalised",
);

// Interprint prints width in cm (126.0) — callers convert, and a fractional mm from that
// conversion must not produce a second key for the same roll.
assert(
  buildMaterialKey({ supplierCode: "INTERPRINT", designCode: "083860/004", widthMm: 1260.4, gsm: 75 }) ===
    "INTERPRINT|083860/004|1260|75",
  "width rounded to whole mm",
);

console.log("materialKey selfCheck OK");
