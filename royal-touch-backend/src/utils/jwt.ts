import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthPayload } from "../types/express";

// Unlike the portal (whose tokens never expire), the API doc specifies a refresh
// endpoint "to refresh an expired access token" — so access tokens are short-lived and
// the long-lived refresh token is what keeps an operator logged in across a shift.
const ACCESS_TOKEN_TTL = "12h";
const REFRESH_TOKEN_TTL = "60d";

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(payload: { userId: string }): string {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AuthPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AuthPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { userId: string };
}
