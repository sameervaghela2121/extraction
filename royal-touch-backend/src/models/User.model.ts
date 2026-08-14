import { Schema, model, Types } from "mongoose";

export interface IUser {
  _id: Types.ObjectId;
  employeeId: string;
  name: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    // The doc's login field ("username/employeeId"). Stored uppercase and matched
    // uppercase so a shop-floor operator typing "emp001" still gets in.
    employeeId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    // ponytail: a single boolean, not the portal's invited/active/suspended enum —
    // there is no invite flow here, users are created by an admin.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
