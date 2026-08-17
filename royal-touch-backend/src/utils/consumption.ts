/** Scales report grams; anything below this is noise, not a real weight difference. */
const WEIGHT_EPSILON_KG = 0.001;

export type ReturnOutcome = {
  consumedKg: number;
  status: "RETURNED" | "FULLY_CONSUMED";
  newRollStatus: "IN_STOCK" | "CONSUMED";
};

/**
 * Closes an issue cycle: what the client used, and what state that leaves the roll in.
 *
 * Kept as a pure function so the rule is testable without a database — it is the one
 * calculation in the system that money and stock both depend on.
 */
export function settleReturn(issuedWeightKg: number, returnedWeightKg: number): ReturnOutcome {
  // A roll cannot come back heavier than it left. In practice this is a keying slip —
  // 5 typed as 50 — and it must fail loudly rather than record negative consumption.
  if (returnedWeightKg > issuedWeightKg + WEIGHT_EPSILON_KG) {
    throw new Error(
      `Returned weight (${returnedWeightKg}kg) cannot exceed issued weight (${issuedWeightKg}kg)`,
    );
  }

  const consumedKg = Math.max(0, issuedWeightKg - returnedWeightKg);
  const isSpent = returnedWeightKg <= WEIGHT_EPSILON_KG;

  return {
    consumedKg,
    status: isSpent ? "FULLY_CONSUMED" : "RETURNED",
    newRollStatus: isSpent ? "CONSUMED" : "IN_STOCK",
  };
}
