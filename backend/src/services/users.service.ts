import crypto from "crypto";
import { Types } from "mongoose";
import { User, type UserRole, type UserStatus } from "../models/User.model";
import { Invite } from "../models/Invite.model";
import { DocumentModel } from "../models/Document.model";
import { emailService } from "./email.service";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { GODOWN_ROLES } from "../validators/users.validators";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const usersService = {
  // Staff and admin accounts are managed outside this panel, and super_admin never shows
  // up anywhere (see User.model.ts) — so this list is godown roles only, for every caller,
  // not just filtered in the UI. A godown_supervisor now has API access to this same list
  // (see users.routes.ts), so this also doubles as the confidentiality boundary: they must
  // never see a staff/admin/super_admin row even by calling the endpoint directly.
  async list() {
    const users = await User.find({ role: { $in: GODOWN_ROLES } })
      .sort({ createdAt: 1 })
      .lean();
    const counts = await DocumentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $group: { _id: "$ownerId", count: { $sum: 1 } } },
    ]);
    const countByUser = new Map(counts.map((c) => [c._id.toString(), c.count]));

    return users.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      docCount: countByUser.get(u._id.toString()) ?? 0,
    }));
  },

  async invite(input: { name: string; email: string; role: UserRole }, actingUserRole: UserRole) {
    // The validator already restricts role to godown_supervisor/godown_operator for every
    // caller — this narrows it further for a supervisor specifically. Checked here, not in
    // the route, because a route gate never sees the request body.
    if (actingUserRole === "godown_supervisor" && input.role !== "godown_operator") {
      throw ApiError.forbidden("Godown supervisors can only invite godown operators");
    }

    const email = input.email.toLowerCase();
    const existing = await User.findOne({ email });
    if (existing && existing.status !== "invited") {
      throw ApiError.conflict("A user with this email already exists");
    }
    // Same rule as update/remove: an existing row, even one still sitting at "invited",
    // is not this endpoint's to touch once its role is outside what this panel manages.
    if (existing && !GODOWN_ROLES.includes(existing.role as (typeof GODOWN_ROLES)[number])) {
      throw ApiError.forbidden("This account is managed outside this panel");
    }

    const user =
      existing ??
      (await User.create({
        name: input.name,
        email,
        role: input.role,
        status: "invited",
        invitedAt: new Date(),
      }));
    if (existing) {
      existing.name = input.name;
      existing.role = input.role;
      existing.invitedAt = new Date();
      await existing.save();
    }

    const token = crypto.randomBytes(24).toString("hex");
    await Invite.create({
      email,
      name: input.name,
      role: input.role,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await emailService.sendInvite(email, input.name, `${env.frontendOrigin}/accept-invite/${token}`);

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      docCount: 0,
    };
  },

  async update(id: string, updates: { role?: UserRole; status?: UserStatus }, actingUserId: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid user id");
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    // The validator already refuses "super_admin" as a value to set — this refuses the
    // account to touch at all, so a super_admin's own role/status can't be edited away
    // through the app either. Both directions have to hold for "Mongo-only" to mean
    // anything.
    if (user.role === "super_admin") {
      throw ApiError.forbidden("Super admin accounts can only be changed directly in the database");
    }
    if (user._id.toString() === actingUserId && updates.role && updates.role !== "admin") {
      throw ApiError.badRequest("You cannot remove your own admin role");
    }
    if (updates.role) user.role = updates.role;
    if (updates.status) user.status = updates.status;
    await user.save();
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  },

  async remove(id: string, actingUserId: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest("Invalid user id");
    if (id === actingUserId) throw ApiError.badRequest("You cannot delete your own account");
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    if (user.role === "super_admin") {
      throw ApiError.forbidden("Super admin accounts can only be changed directly in the database");
    }
    user.status = "suspended";
    await user.save();
    return { id: user._id.toString(), status: user.status };
  },
};
