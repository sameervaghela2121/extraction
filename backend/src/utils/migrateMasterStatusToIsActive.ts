/**
 * One-time migration: status "active"/"inactive" -> is_active boolean, for the three
 * masters that still had it (raw_materials, remarks, vendors — locations was already
 * done by migrateLocationRefs.ts, in the same commit that added is_active to those models).
 *
 *   npx tsx src/utils/migrateMasterStatusToIsActive.ts                 # dry run
 *   npx tsx src/utils/migrateMasterStatusToIsActive.ts --apply         # write
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * Safe to re-run: only rows that still have a `status` key are touched. Anything other
 * than the literal string "inactive" becomes is_active: true, same rule the locations
 * migration used.
 *
 * Raw collections, not the models: the models now declare is_active, and would ignore
 * `status` entirely on read.
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { RawMaterial } from "../models/RawMaterial.model";
import { Remark } from "../models/Remark.model";
import { Vendor } from "../models/Vendor.model";
import { logger } from "./logger";

const COLLECTIONS = [
  { name: "raw_materials", model: RawMaterial },
  { name: "remarks", model: Remark },
  { name: "vendors", model: Vendor },
];

async function main() {
  const apply = process.argv.includes("--apply");

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  let totalNeeding = 0;

  for (const { name, model } of COLLECTIONS) {
    const collection = model.collection;
    const rows = (await collection
      .find({ status: { $exists: true } }, { projection: { status: 1 } })
      .toArray()) as Array<{ _id: mongoose.Types.ObjectId; status: unknown }>;

    logger.info(`${name}: ${rows.length} row(s) still have status`);
    totalNeeding += rows.length;

    if (!rows.length) continue;
    if (!apply) continue;

    const ops = rows.map((r) => ({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { is_active: r.status !== "inactive" }, $unset: { status: "" } },
      },
    }));
    const result = await collection.bulkWrite(ops, { ordered: false });
    logger.info(`  written: ${result.modifiedCount} updated`);
  }

  if (!totalNeeding) {
    logger.info("nothing to do — every row already has is_active and no status.");
  } else if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error("Master status migration failed:", err);
  process.exit(1);
});
