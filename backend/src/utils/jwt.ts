import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthPayload } from "../types/express";

export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn as SignOptions["expiresIn"],
  });
}

export function signRefreshToken(payload: { userId: string }): string {
  return jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn as SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AuthPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AuthPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { userId: string };
}
