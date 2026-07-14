import { Schema, model, Types } from "mongoose";
import type { UserRole } from "./User.model";

export interface IInvite {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: UserRole;
  token: string;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const inviteSchema = new Schema<IInvite>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["staff", "admin"], required: true },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
);

export const Invite = model<IInvite>("Invite", inviteSchema);
