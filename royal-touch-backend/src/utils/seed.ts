import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { User } from "../models/User.model";
import { logger } from "./logger";

const SEED_EMPLOYEE_ID = (process.env.SEED_EMPLOYEE_ID ?? "EMP001").toUpperCase();
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? "royal@123";
const SEED_NAME = process.env.SEED_USER_NAME ?? "Royal Touch Operator";

async function main() {
  await connectDb();

  const existing = await User.findOne({ employeeId: SEED_EMPLOYEE_ID });
  if (existing) {
    logger.info(`User already exists: ${SEED_EMPLOYEE_ID}`);
  } else {
    await User.create({
      employeeId: SEED_EMPLOYEE_ID,
      name: SEED_NAME,
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
    });
    logger.info(`Created user: ${SEED_EMPLOYEE_ID} / ${SEED_PASSWORD}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Seed failed:", err);
  process.exit(1);
});
