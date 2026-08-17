/** `npx tsx src/utils/escapeRegex.selfcheck.ts` — no DB, no server needed. */
import { escapeRegex } from "./escapeRegex";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfCheck failed: ${msg}`);
}

// A literal dot must match only a dot, not "any character".
assert(!new RegExp(escapeRegex("."), "i").test("x"), "dot is literal");
assert(new RegExp(escapeRegex("14-50085.100"), "i").test("14-50085.100"), "design code matches");

// The quantifier pileup that makes a naive regex backtrack catastrophically.
const evil = "a" + "+".repeat(30) + "b";
const start = Date.now();
assert(!new RegExp(escapeRegex(evil), "i").test("a".repeat(40)), "no match on quantifier soup");
assert(Date.now() - start < 100, "escaped pattern evaluates instantly");

// Real supplier values from the labels contain regex metacharacters.
assert(new RegExp(escapeRegex("083860/004"), "i").test("083860/004"), "slash in design code");
assert(new RegExp(escapeRegex("(FSC)"), "i").test("Paper (FSC) mix"), "parentheses");
assert(!new RegExp(escapeRegex("Lamella"), "i").test("Twinkle"), "non-match still fails");

// Case-insensitivity is the caller's flag, not the escaping's job.
assert(new RegExp(escapeRegex("lamella"), "i").test("Lamella"), "case-insensitive search");

console.log("escapeRegex selfCheck OK");
