import { Schema, model, Types } from "mongoose";

export const USER_ROLES = ["staff", "admin", "store_manager"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = "invited" | "active" | "suspended";

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash?: string;
  role: UserRole;
  status: UserStatus;
  invitedAt?: Date;
  resetToken?: string;
  resetTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: [...USER_ROLES], default: "staff" },
    status: { type: String, enum: ["invited", "active", "suspended"], default: "invited" },
    invitedAt: { type: Date },
    resetToken: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
