import assert from "assert";
import { buildClientNameKey } from "../models/Client.model";

/**
 * The dedupe key decides whether two operators typing the same customer get one row or
 * two. Getting it wrong splits that customer's consumption total, which is the exact
 * failure the Client collection exists to prevent.
 */

// The three spellings named in the Client model comment must collapse to one key.
assert.strictEqual(buildClientNameKey("Client A"), buildClientNameKey("client a"));
assert.strictEqual(buildClientNameKey("Client A"), buildClientNameKey("CLIENT A"));

// Typing slips on a phone: stray spaces, leading/trailing whitespace, a tab.
assert.strictEqual(buildClientNameKey("Client  A"), buildClientNameKey("Client A"));
assert.strictEqual(buildClientNameKey("  Client A  "), buildClientNameKey("Client A"));
assert.strictEqual(buildClientNameKey("Client\tA"), buildClientNameKey("Client A"));

// Genuinely different customers must NOT collapse — over-normalising is the worse bug,
// because it silently merges two companies' billing.
assert.notStrictEqual(buildClientNameKey("Shree Laminates"), buildClientNameKey("Shree Lamination"));
assert.notStrictEqual(buildClientNameKey("Client A"), buildClientNameKey("ClientA"));

console.log("clientNameKey selfcheck ok");
