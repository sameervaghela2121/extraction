import crypto from "crypto";
import { Types } from "mongoose";
import { User, type UserRole, type UserStatus } from "../models/User.model";
import { Invite } from "../models/Invite.model";
import { DocumentModel } from "../models/Document.model";
import { emailService } from "./email.service";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const usersService = {
  async list() {
    const users = await User.find().sort({ createdAt: 1 }).lean();
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

  async invite(input: { name: string; email: string; role: UserRole }) {
    const email = input.email.toLowerCase();
    const existing = await User.findOne({ email });
    if (existing && existing.status !== "invited") {
      throw ApiError.conflict("A user with this email already exists");
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
    user.status = "suspended";
    await user.save();
    return { id: user._id.toString(), status: user.status };
  },
};
