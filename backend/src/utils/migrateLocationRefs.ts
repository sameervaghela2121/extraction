/**
 * One-time migration: location strings -> Location ObjectIds, and Location.status -> is_active.
 *
 *   npx tsx src/utils/migrateLocationRefs.ts                         # dry run, changes nothing
 *   npx tsx src/utils/migrateLocationRefs.ts --apply                 # write
 *   npx tsx src/utils/migrateLocationRefs.ts --apply --unmatched-to-null
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * - material_rolls.location and stock_transactions.from_location / to_location: each
 *   string is matched to a Location by location_code, then by name (case-insensitive).
 *   A roll that went back to its vendor gets null, as does a RETURN_TO_VENDOR's
 *   to_location (it held the vendor's name, not a location).
 * - locations.status "active"/"inactive" becomes is_active true/false, status is removed.
 *
 * Any string that matches no Location is listed and --apply refuses to write, unless
 * --unmatched-to-null says to store null for those. Safe to re-run: only string values
 * and leftover status fields are touched.
 *
 * Raw collections, not the models: the models now declare ObjectIds, and would try to
 * cast the old strings on the way in.
 */
import mongoose, { Types } from "mongoose";
import { connectDb } from "../config/db";
import { Location } from "../models/Location.model";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { StockTransaction } from "../models/StockTransaction.model";
import { logger } from "./logger";

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type UpdateOp = { updateOne: { filter: { _id: Types.ObjectId }; update: Record<string, Record<string, unknown>> } };

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const unmatchedToNull = args.includes("--unmatched-to-null");

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  const locations = Location.collection;
  const rolls = MaterialRoll.collection;
  const transactions = StockTransaction.collection;

  // --- locations: status -> is_active -----------------------------------------------
  const allLocations = (await locations.find({}).toArray()) as Doc[];
  const locationOps: UpdateOp[] = allLocations
    .filter((l) => l.status !== undefined || l.is_active === undefined)
    .map((l) => ({
      updateOne: {
        filter: { _id: l._id },
        update: { $set: { is_active: l.status !== "inactive" }, $unset: { status: "" } },
      },
    }));

  const byId = new Map(allLocations.map((l) => [l._id.toString(), l._id]));
  const byCode = new Map<string, Types.ObjectId>();
  const byName = new Map<string, Types.ObjectId | "ambiguous">();
  for (const l of allLocations) {
    byCode.set(String(l.location_code).trim().toUpperCase(), l._id);
    const name = String(l.name).trim().toLowerCase();
    byName.set(name, byName.has(name) ? "ambiguous" : l._id);
  }

  const unmatched = new Map<string, number>();
  /** undefined = no match. null = deliberately empty. */
  function resolveLocation(value: string): Types.ObjectId | null | undefined {
    const v = value.trim();
    if (!v) return null;
    const hit = byId.get(v) ?? byCode.get(v.toUpperCase());
    if (hit) return hit;
    const named = byName.get(v.toLowerCase());
    if (named && named !== "ambiguous") return named;
    unmatched.set(v, (unmatched.get(v) ?? 0) + 1);
    return undefined;
  }

  // --- material_rolls.location ------------------------------------------------------
  const rollOps: UpdateOp[] = [];
  const stringRolls = (await rolls
    .find({ location: { $type: "string" } }, { projection: { location: 1, status: 1 } })
    .toArray()) as Doc[];
  for (const r of stringRolls) {
    const id =
      r.status === "RETURNED_TO_VENDOR" ? null : resolveLocation(r.location as string);
    if (id === undefined && !unmatchedToNull) continue;
    rollOps.push({ updateOne: { filter: { _id: r._id }, update: { $set: { location: id ?? null } } } });
  }

  // --- stock_transactions.from_location / to_location -------------------------------
  const txOps: UpdateOp[] = [];
  const stringTxs = (await transactions
    .find(
      { $or: [{ from_location: { $type: "string" } }, { to_location: { $type: "string" } }] },
      { projection: { from_location: 1, to_location: 1, transaction_type: 1 } },
    )
    .toArray()) as Doc[];
  let txSkipped = 0;
  for (const t of stringTxs) {
    const set: Record<string, Types.ObjectId | null> = {};
    let skip = false;
    for (const field of ["from_location", "to_location"] as const) {
      const value = t[field];
      if (typeof value !== "string") continue;
      const id =
        field === "to_location" && t.transaction_type === "RETURN_TO_VENDOR"
          ? null
          : resolveLocation(value);
      if (id === undefined && !unmatchedToNull) skip = true;
      set[field] = id ?? null;
    }
    if (skip) {
      txSkipped++;
      continue;
    }
    txOps.push({ updateOne: { filter: { _id: t._id }, update: { $set: set } } });
  }

  logger.info(`locations: ${locationOps.length} of ${allLocations.length} need status -> is_active`);
  logger.info(`rolls: ${stringRolls.length} with a string location, ${rollOps.length} ready to write`);
  logger.info(
    `movements: ${stringTxs.length} with a string location, ${txOps.length} ready to write, ${txSkipped} held back`,
  );
  if (unmatched.size) {
    logger.warn(`${unmatched.size} location value(s) match no Location:`);
    for (const [value, count] of [...unmatched].sort((a, b) => b[1] - a[1])) {
      logger.warn(`  "${value}"  x${count}`);
    }
  }

  if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  } else if (unmatched.size && !unmatchedToNull) {
    logger.error(
      "not written: fix the values above (add the missing Locations, or correct the rows), " +
        "or re-run with --unmatched-to-null to store null for them.",
    );
    process.exitCode = 1;
  } else {
    if (locationOps.length) await locations.bulkWrite(locationOps, { ordered: false });
    if (rollOps.length) await rolls.bulkWrite(rollOps, { ordered: false });
    if (txOps.length) await transactions.bulkWrite(txOps, { ordered: false });
    logger.info(
      `written: ${locationOps.length} locations, ${rollOps.length} rolls, ${txOps.length} movements`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error("Location migration failed:", err);
  process.exit(1);
});
