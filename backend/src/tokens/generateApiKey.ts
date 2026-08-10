import crypto from "crypto";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { ApiToken } from "./ApiToken.model";
import { logger } from "../utils/logger";

function newKey(): string {
  return `df_${crypto.randomBytes(24).toString("hex")}`;
}

async function main() {
  await connectDb();

  const key = newKey();
  await ApiToken.create({ key, isRevoked: false });

  logger.info(`Created API key: ${key}`);
  console.log(key);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("API key generation failed:", err);
  process.exit(1);
});
