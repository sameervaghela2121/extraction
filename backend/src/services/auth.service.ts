import crypto from "crypto";
import bcrypt from "bcryptjs";
import { User, type IUser } from "../models/User.model";
import { Invite } from "../models/Invite.model";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { emailService } from "./email.service";
import type { AuthPayload } from "../types/express";

function toPayload(user: IUser): AuthPayload {
  return { userId: user._id.toString(), role: user.role, name: user.name, email: user.email };
}

function issueTokens(user: IUser) {
  return {
    accessToken: signAccessToken(toPayload(user)),
    refreshToken: signRefreshToken({ userId: user._id.toString() }),
  };
}

export const authService = {
  async login(email: string, password: string) {
    const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
    if (!user || !user.passwordHash) {
      throw ApiError.unauthorized("Invalid email or password");
    }
    if (user.status === "suspended") {
      throw ApiError.forbidden("Your account has been suspended");
    }
    if (user.status === "invited") {
      throw ApiError.forbidden("Please accept your invite before logging in");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw ApiError.unauthorized("Invalid email or password");
    }
    return { user: toPayload(user), ...issueTokens(user) };
  },

  async refresh(refreshToken: string) {
    let decoded: { userId: string };
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      throw ApiError.unauthorized("Invalid or expired refresh token");
    }
    const user = await User.findById(decoded.userId);
    if (!user || user.status !== "active") {
      throw ApiError.unauthorized("Account is no longer active");
    }
    return { user: toPayload(user), ...issueTokens(user) };
  },

  async acceptInvite(token: string, password: string) {
    const invite = await Invite.findOne({ token });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw ApiError.badRequest("This invite is invalid or has expired");
    }
    const user = await User.findOne({ email: invite.email });
    if (!user) {
      throw ApiError.notFound("Invited user not found");
    }
    user.passwordHash = await bcrypt.hash(password, 10);
    user.status = "active";
    await user.save();
    invite.acceptedAt = new Date();
    await invite.save();
    return { user: toPayload(user), ...issueTokens(user) };
  },

  async forgotPassword(email: string, resetBaseUrl: string) {
    const user = await User.findOne({ email: email.toLowerCase() });
    // Always resolve without revealing whether the account exists.
    if (!user || user.status === "suspended") return;
    const rawToken = crypto.randomBytes(32).toString("hex");
    user.resetToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    await emailService.sendPasswordReset(user.email, `${resetBaseUrl}?token=${rawToken}`);
  },

  async resetPassword(rawToken: string, password: string) {
    const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");
    const user = await User.findOne({
      resetToken: hashed,
      resetTokenExpires: { $gt: new Date() },
    }).select("+resetToken +resetTokenExpires");
    if (!user) {
      throw ApiError.badRequest("This reset link is invalid or has expired");
    }
    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    if (user.status === "invited") user.status = "active";
    await user.save();
    return { user: toPayload(user), ...issueTokens(user) };
  },

  async me(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound("User not found");
    return toPayload(user);
  },

  // Re-export so the frontend reset URL base is consistent across services.
  frontendOrigin: env.frontendOrigin,
};
