import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthPayload } from "../types/express";

// No expiresIn: these tokens never expire once issued. The only way to invalidate an
// outstanding token is rotating JWT_ACCESS_SECRET / JWT_REFRESH_SECRET, which logs out
// every user at once — there's no per-token or per-user revocation.
export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret);
}

export function signRefreshToken(payload: { userId: string }): string {
  return jwt.sign(payload, env.jwtRefreshSecret);
}

export function verifyAccessToken(token: string): AuthPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AuthPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { userId: string };
}
