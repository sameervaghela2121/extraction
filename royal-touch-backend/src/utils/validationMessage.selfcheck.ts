import assert from "assert";
import { updateStatusSchema, createRollSchema } from "../validators/rolls.validators";
import { adjustWeightSchema } from "../validators/rolls.validators";
import { toReadableValidationError } from "./validationMessage";
import { ZodError } from "zod";

/**
 * These messages are shown to an operator holding a roll. The failure this guards against
 * is the one we actually hit: a missing field reported as "expected number, received nan",
 * which reads like a bad value and sends everyone looking in the wrong place.
 */
function readable(schema: { parse: (v: unknown) => unknown }, input: unknown) {
  try {
    schema.parse(input);
    throw new Error("expected validation to fail");
  } catch (err) {
    assert.ok(err instanceof ZodError, "expected a ZodError");
    return toReadableValidationError(err);
  }
}

// The exact case from the field: IN with no weight.
const missing = readable(updateStatusSchema, { status: "IN" });
assert.strictEqual(missing.message, "Returned weight is required");
assert.strictEqual(missing.fields.returnedWeightKg, "Returned weight is required");

// Wrong field name looks identical to the caller — the required field is still absent.
const wrongName = readable(updateStatusSchema, { status: "IN", weight: 240 });
assert.strictEqual(wrongName.message, "Returned weight is required");

// Sent, but not a number: a different mistake, and must read differently.
const malformed = readable(updateStatusSchema, { status: "IN", returnedWeightKg: "abc" });
assert.notStrictEqual(malformed.message, "Returned weight is required");
assert.match(malformed.message, /Returned weight/);

// Lowercase status: name the valid values rather than saying "invalid discriminator".
const badStatus = readable(updateStatusSchema, { status: "in", returnedWeightKg: 240 });
assert.match(badStatus.message, /Status must be one of: OUT, IN/);

// OUT without a client.
assert.strictEqual(readable(updateStatusSchema, { status: "OUT" }).message, "Client is required");

// Schema-authored messages survive unparaphrased.
assert.strictEqual(
  readable(adjustWeightSchema, { currentWeightKg: 10 }).message,
  "Reason is required",
);

// Unlabelled fields fall back to a humanised name, with the unit suffix dropped.
const roll = readable(createRollSchema, { barcodeId: "RT-000001", materialId: "a".repeat(24) });
assert.strictEqual(roll.fields.receivedWeightKg, "Received weight is required");

// Several problems at once: every field is reported, joined into one sentence.
const many = readable(createRollSchema, {});
assert.ok(Object.keys(many.fields).length >= 3);
assert.ok(many.message.includes("Barcode"));

console.log("validationMessage selfcheck ok");
