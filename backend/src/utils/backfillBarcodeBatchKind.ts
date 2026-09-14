/**
 * Stamp `kind: "barcode"` onto barcode batches saved before the field existed.
 *
 *   npx tsx src/utils/backfillBarcodeBatchKind.ts            # dry run, changes nothing
 *   npx tsx src/utils/backfillBarcodeBatchKind.ts --apply    # write
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * Safe to run more than once — only documents missing the field are touched, so a second
 * run always reports zero left to update.
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { BarcodeBatch } from "../models/BarcodeBatch.model";
import { logger } from "./logger";

async function main() {
  const apply = process.argv.includes("--apply");

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  const missing = await BarcodeBatch.countDocuments({ kind: { $exists: false } });
  logger.info(`${missing} barcode batch(es) missing a kind — all of them predate QR support`);

  if (missing === 0) {
    logger.info("nothing to do.");
  } else if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  } else {
    const result = await BarcodeBatch.updateMany(
      { kind: { $exists: false } },
      { $set: { kind: "barcode" } },
    );
    logger.info(`written: ${result.modifiedCount} updated`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Backfill failed:", err);
  process.exit(1);
});
