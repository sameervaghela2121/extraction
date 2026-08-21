/**
 * Self-check for the movement schema's photo rules. No test runner in this repo:
 *   npx tsx src/validators/stock.validators.check.ts
 */
import assert from "node:assert/strict";
import { recordMovementSchema } from "./stock.validators";

const GOOD = "rolls/2026/08/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.jpg";
const base = {
  transaction_type: "OUT" as const,
  material_id: "68f4a1b2c3d4e5f678901234",
  roll_id: "68f4a1b2c3d4e5f678901235",
  location: "Rack A",
};

// Photos are optional — the flow that existed before this field still validates.
assert.equal(recordMovementSchema.safeParse(base).success, true);

// An OUT and a RETURN both carry them.
assert.equal(recordMovementSchema.safeParse({ ...base, photo_paths: [GOOD] }).success, true);
assert.equal(
  recordMovementSchema.safeParse({
    transaction_type: "RETURN",
    material_id: base.material_id,
    roll_id: base.roll_id,
    returned_weight: 47,
    photo_paths: [GOOD, GOOD],
  }).success,
  true,
);

// The whole point of the regex: a path we did not mint must not become a signed read URL
// for someone else's object in the same bucket.
assert.equal(
  recordMovementSchema.safeParse({ ...base, photo_paths: ["invoices/secret.pdf"] }).success,
  false,
);
assert.equal(
  recordMovementSchema.safeParse({ ...base, photo_paths: ["rolls/../../etc/passwd"] }).success,
  false,
);

// Capped, so the ledger cannot be used as photo storage.
assert.equal(
  recordMovementSchema.safeParse({ ...base, photo_paths: Array(5).fill(GOOD) }).success,
  false,
);

console.log("stock.validators photo rules: ok");
