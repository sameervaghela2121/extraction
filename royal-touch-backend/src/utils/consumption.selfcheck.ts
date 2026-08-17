/** `npx tsx src/utils/consumption.selfcheck.ts` — no DB, no server needed. */
import { settleReturn } from "./consumption";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfCheck failed: ${msg}`);
}

// The scenario this whole model exists for: one roll, two clients, in sequence.
//   received 10kg → out to A at 10 → back at 5   (A consumed 5)
//                 → out to B at 5  → back at 2   (B consumed 3)
const fromClientA = settleReturn(10, 5);
assert(fromClientA.consumedKg === 5, "client A consumed 5kg");
assert(fromClientA.status === "RETURNED", "cycle closed, roll came back");
assert(fromClientA.newRollStatus === "IN_STOCK", "roll is back in stock at 5kg");

const fromClientB = settleReturn(5, 2);
assert(fromClientB.consumedKg === 3, "client B consumed 3kg, not 8");
assert(fromClientB.newRollStatus === "IN_STOCK", "2kg left, still stock");

// Every gram is accounted for across the roll's whole life.
assert(fromClientA.consumedKg + fromClientB.consumedKg + 2 === 10, "10kg fully reconciled");

// Nothing came back — the client used it up. Whole issued weight is theirs.
const spent = settleReturn(5, 0);
assert(spent.consumedKg === 5, "fully consumed attributes everything");
assert(spent.status === "FULLY_CONSUMED", "cycle closed as consumed");
assert(spent.newRollStatus === "CONSUMED", "roll leaves stock");

// Returned untouched: a real outcome, and consumption must be zero rather than negative.
const untouched = settleReturn(10, 10);
assert(untouched.consumedKg === 0, "unused roll consumes nothing");
assert(untouched.newRollStatus === "IN_STOCK", "still in stock");

// The keying slip: 5 typed as 50. Must throw, not record -45kg consumed.
let rejected = false;
try {
  settleReturn(5, 50);
} catch {
  rejected = true;
}
assert(rejected, "return heavier than issue is rejected");

// Float noise from a scale must not trip the guard or leave a phantom 0.0000001kg roll.
assert(settleReturn(10.1, 10.1).consumedKg === 0, "identical float weights consume zero");
assert(settleReturn(5, 0.0005).newRollStatus === "CONSUMED", "sub-gram remainder is spent");

console.log("consumption selfCheck OK");
