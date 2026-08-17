import { Schema, model, Types } from "mongoose";

/**
 * Who a roll goes out to. Its own collection rather than a name typed onto each issue,
 * because consumption is reported per client — and "Client A", "client a" and "CLIENT-A"
 * typed on three different days would split one customer's total three ways.
 */
export interface IClient {
  _id: Types.ObjectId;
  code: string;
  name: string;
  nameKey: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The comparison form of a name: lowercased with runs of whitespace collapsed.
 *
 * A case-insensitive collation index would catch "client a" but not "Client  A" typed with
 * a stray double space — and on the issue screen the operator is typing one-handed while
 * holding a roll. Both must resolve to the same customer.
 */
export function buildClientNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const clientSchema = new Schema<IClient>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Derived, never client-supplied: a caller who can set the dedupe key can defeat the dedupe.
clientSchema.pre("validate", function (next) {
  if (this.name) this.nameKey = buildClientNameKey(this.name);
  next();
});

export const Client = model<IClient>("Client", clientSchema);
