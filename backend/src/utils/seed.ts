import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { User } from "../models/User.model";
import { fieldDefinitionsService } from "../services/fieldDefinitions.service";
import { logger } from "./logger";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@docflow.app";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin@123";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "DocFlow Admin";

async function main() {
  await connectDb();
  await fieldDefinitionsService.ensureDefaults();

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    logger.info(`Admin user already exists: ${ADMIN_EMAIL}`);
  } else {
    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
      role: "admin",
      status: "active",
    });
    logger.info(`Created admin user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Seed failed:", err);
  process.exit(1);
});
