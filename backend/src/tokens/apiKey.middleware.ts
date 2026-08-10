import type { Request, Response, NextFunction } from "express";
import { ApiToken } from "./ApiToken.model";
import { ApiError } from "../utils/ApiError";

const HEADER = "df-api-key";

/** Gates a router behind a static key passed in the `df-api-key` header. */
export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const key = req.headers[HEADER];
  if (!key || typeof key !== "string") {
    throw ApiError.unauthorized("Missing df-api-key header");
  }
  const token = await ApiToken.findOne({ key }).lean();
  if (!token || token.isRevoked) {
    throw ApiError.unauthorized("Invalid or revoked API key");
  }
  next();
}
