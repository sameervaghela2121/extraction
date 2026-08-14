import bcrypt from "bcryptjs";
import { User, type IUser } from "../models/User.model";
import { ApiError } from "../utils/ApiError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import type { AuthPayload } from "../types/express";

function toPayload(user: IUser): AuthPayload {
  return {
    userId: user._id.toString(),
    employeeId: user.employeeId,
    name: user.name,
  };
}

export const authService = {
  /** POST /api/v1/auth/login — returns accessToken, refreshToken, userId, name. */
  async login(employeeId: string, password: string) {
    const user = await User.findOne({
      employeeId: employeeId.toUpperCase(),
    }).select("+passwordHash");

    // One message for both "no such user" and "wrong password" — telling them apart
    // lets anyone enumerate valid employee IDs.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw ApiError.unauthorized("Invalid employee ID or password");
    }
    if (!user.isActive) {
      throw ApiError.forbidden("This account is no longer active");
    }

    const payload = toPayload(user);
    return {
      ...payload,
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken({ userId: payload.userId }),
    };
  },

  /** POST /api/v1/auth/refresh — the doc returns only a new accessToken. */
  async refresh(refreshToken: string) {
    let decoded: { userId: string };
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      throw ApiError.unauthorized("Invalid or expired refresh token");
    }
    // Re-read the user rather than trusting the token's claims: a deactivated user
    // must stop being able to mint fresh access tokens.
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized("This account is no longer active");
    }
    return { accessToken: signAccessToken(toPayload(user)) };
  },
};
