/**
 * Stamp a sticker size onto barcode batches saved before size was recorded per run.
 *
 *   npx tsx src/utils/backfillBarcodeBatchSize.ts            # dry run, changes nothing
 *   npx tsx src/utils/backfillBarcodeBatchSize.ts --apply    # write
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * The size these runs actually printed at was never recorded, so this is a best-effort
 * guess, not a recovery: barcode runs get 100x50mm (the app's original, only, size before
 * sizing was configurable), and QR runs get 40x40mm (the QR feature's own default) — sized
 * per kind so a QR run doesn't come back thinking it was made on a wide barcode-shaped
 * label. Safe to run more than once — only documents missing the field are touched.
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { BarcodeBatch } from "../models/BarcodeBatch.model";
import { logger } from "./logger";

const DEFAULTS = {
  barcode: { widthMm: 100, heightMm: 50 },
  qr: { widthMm: 40, heightMm: 40 },
} as const;

async function main() {
  const apply = process.argv.includes("--apply");

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  let totalMissing = 0;
  for (const [kind, size] of Object.entries(DEFAULTS)) {
    const missing = await BarcodeBatch.countDocuments({ kind, widthMm: { $exists: false } });
    totalMissing += missing;
    logger.info(`${missing} "${kind}" batch(es) missing a size — defaulting to ${size.widthMm}x${size.heightMm}mm`);

    if (missing > 0 && apply) {
      const result = await BarcodeBatch.updateMany(
        { kind, widthMm: { $exists: false } },
        { $set: size },
      );
      logger.info(`  written: ${result.modifiedCount} updated`);
    }
  }

  if (totalMissing === 0) {
    logger.info("nothing to do.");
  } else if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Backfill failed:", err);
  process.exit(1);
});
