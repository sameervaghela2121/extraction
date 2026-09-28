/**
 * One-time migration: is_active true/false -> status "active"/"inactive", on every master
 * (locations, raw_materials, remarks, vendors). Reverses the earlier boolean change: a
 * string enum takes a third state as one more value in MASTER_STATUSES, a boolean needs a
 * migration.
 *
 *   npx tsx src/utils/migrateIsActiveToStatus.ts                           # dry run
 *   npx tsx src/utils/migrateIsActiveToStatus.ts --apply --keep-is-active  # before deploy
 *   npx tsx src/utils/migrateIsActiveToStatus.ts --apply                   # after deploy
 *
 * --keep-is-active writes status without removing is_active, so the code still running
 * (which reads is_active) and the code about to run (which reads status) both see every
 * row correctly while the deploy rolls over. The plain --apply after the deploy re-derives
 * status from is_active — picking up anything the old code changed in the meantime — and
 * removes is_active for good.
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * Safe to re-run: only rows that still carry is_active are touched. is_active: false
 * becomes "inactive", anything else "active". A row carrying both keys takes its value
 * from is_active — that is the newer write.
 *
 * Raw collections, not the models: the models now declare status, and would ignore
 * is_active on read.
 */
import mongoose, { Types } from "mongoose";
import { connectDb } from "../config/db";
import { Location } from "../models/Location.model";
import { RawMaterial } from "../models/RawMaterial.model";
import { Remark } from "../models/Remark.model";
import { Vendor } from "../models/Vendor.model";
import { logger } from "./logger";

const MODELS = [Location, RawMaterial, Remark, Vendor];

async function main() {
  const apply = process.argv.includes("--apply");
  const keepIsActive = process.argv.includes("--keep-is-active");

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  let total = 0;
  for (const model of MODELS) {
    const collection = model.collection;
    const rows = (await collection
      .find({ is_active: { $exists: true } }, { projection: { is_active: 1 } })
      .toArray()) as Array<{ _id: Types.ObjectId; is_active: unknown }>;

    const inactive = rows.filter((r) => r.is_active === false).length;
    logger.info(
      `${collection.collectionName}: ${rows.length} row(s) to convert (${rows.length - inactive} active, ${inactive} inactive)`,
    );
    total += rows.length;
    if (!apply || !rows.length) continue;

    const result = await collection.bulkWrite(
      rows.map((r) => ({
        updateOne: {
          filter: { _id: r._id },
          update: {
            $set: { status: r.is_active === false ? "inactive" : "active" },
            ...(keepIsActive ? {} : { $unset: { is_active: "" } }),
          },
        },
      })),
      { ordered: false },
    );
    logger.info(`  written: ${result.modifiedCount} updated${keepIsActive ? " (is_active kept)" : ""}`);
  }

  if (!total) logger.info("nothing to do — no row carries is_active.");
  else if (!apply) logger.info("dry run — nothing written. Re-run with --apply to write.");

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error("is_active -> status migration failed:", err);
  process.exit(1);
});
