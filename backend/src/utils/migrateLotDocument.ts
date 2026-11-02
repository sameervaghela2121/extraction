/**
 * One-time migration: a lot's challan_no / challan_photo_path become document_no /
 * document_photo_path, with document_type "challan" — every lot made before a lot could carry
 * an invoice was a challan.
 *
 *   npx tsx src/utils/migrateLotDocument.ts           # dry run
 *   npx tsx src/utils/migrateLotDocument.ts --apply   # right after the deploy
 *
 * Then drop the old challan_no index: npm run indexes -- --only=lots --apply.
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * Safe to re-run: only lots that still carry challan_no are touched.
 *
 * The raw collection, not the model: the model now declares document_no, and would ignore
 * challan_no on read.
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { Lot } from "../models/Lot.model";
import { logger } from "./logger";

async function main() {
  const apply = process.argv.includes("--apply");

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  const filter = { challan_no: { $exists: true } };
  const count = await Lot.collection.countDocuments(filter);
  logger.info(`lots: ${count} lot(s) still on challan_no`);

  if (count && apply) {
    const result = await Lot.collection.updateMany(filter, {
      $rename: { challan_no: "document_no", challan_photo_path: "document_photo_path" },
      $set: { document_type: "challan" },
    });
    logger.info(`  written: ${result.modifiedCount} updated`);
  }

  if (!count) logger.info("nothing to do — no lot carries challan_no.");
  else if (!apply) logger.info("dry run — nothing written. Re-run with --apply to write.");

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error("lot challan -> document migration failed:", err);
  process.exit(1);
});
