import { Schema, model, Types } from "mongoose";

/** OPEN = with the client right now. The two closed states differ only in what came back. */
export type RollIssueStatus = "OPEN" | "RETURNED" | "FULLY_CONSUMED";

/**
 * One out-and-back cycle: the roll leaves for a client at some weight and comes back
 * lighter. The difference is what that client consumed.
 *
 * This is the whole reason IN/OUT can't just be a flag on the roll. A roll issued to
 * client A at 10kg and returned at 5kg, then issued to client B at 5kg and returned at
 * 2kg, has consumed 5kg against A and 3kg against B — and neither number exists anywhere
 * unless the pairing is recorded.
 *
 * Consumption is only knowable at return time, so `consumedKg` is written then, not at
 * issue.
 */
export interface IRollIssue {
  _id: Types.ObjectId;
  rollId: Types.ObjectId;
  clientId: Types.ObjectId;

  issuedWeightKg: number;
  issuedBy: Types.ObjectId;
  issuedAt: Date;
  issuedFromLocationId?: Types.ObjectId;

  returnedWeightKg?: number;
  returnedBy?: Types.ObjectId;
  returnedAt?: Date;
  returnedToLocationId?: Types.ObjectId;

  consumedKg?: number;
  status: RollIssueStatus;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const rollIssueSchema = new Schema<IRollIssue>(
  {
    rollId: { type: Schema.Types.ObjectId, ref: "Roll", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },

    // Copied from the roll's currentWeightKg at issue time — never typed by the operator,
    // or the second issue in a cycle could claim the roll is heavier than it came back.
    issuedWeightKg: { type: Number, required: true, min: 0 },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    issuedAt: { type: Date, required: true, default: Date.now },
    issuedFromLocationId: { type: Schema.Types.ObjectId, ref: "Location" },

    // Weighed on the scale at the office when the roll comes back.
    returnedWeightKg: { type: Number, min: 0 },
    returnedBy: { type: Schema.Types.ObjectId, ref: "User" },
    returnedAt: { type: Date },
    returnedToLocationId: { type: Schema.Types.ObjectId, ref: "Location" },

    consumedKg: { type: Number, min: 0 },
    status: {
      type: String,
      enum: ["OPEN", "RETURNED", "FULLY_CONSUMED"],
      default: "OPEN",
      required: true,
    },
    remarks: { type: String, trim: true },
  },
  { timestamps: true },
);

// A physical roll cannot be at two clients at once. Partial index so only OPEN rows are
// constrained — a roll has many closed cycles over its life, but never two open ones.
// Enforced here rather than in the service because two operators scanning the same roll
// in the same second would both pass an application-level check.
rollIssueSchema.index(
  { rollId: 1 },
  { unique: true, partialFilterExpression: { status: "OPEN" } },
);

// "How much did this client consume in a period" — the reporting query.
rollIssueSchema.index({ clientId: 1, returnedAt: -1 });

export const RollIssue = model<IRollIssue>("RollIssue", rollIssueSchema);
