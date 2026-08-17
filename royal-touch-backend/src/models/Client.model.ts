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
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const clientSchema = new Schema<IClient>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Client = model<IClient>("Client", clientSchema);
