import { Schema, model, Types } from "mongoose";

// godown_supervisor uses both the admin panel and the mobile app; godown_operator is
// app-only (the web login refuses it, same as store_manager).
//
// super_admin is deliberately absent from ASSIGNABLE_USER_ROLES (users.validators.ts) — it
// exists on this list only so the rest of the codebase (auth, rbac, responses) treats it as
// a normal role. No API path can set a user to it or off it; the only way one exists is a
// direct write to Mongo. See requireRole in rbac.middleware.ts for the access side.
export const USER_ROLES = [
  "staff",
  "admin",
  "store_manager",
  "godown_supervisor",
  "godown_operator",
  "super_admin",
] as const;
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
