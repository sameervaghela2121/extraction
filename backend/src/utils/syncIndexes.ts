/**
 * Reconcile the database's indexes with the schemas.
 *
 *   npm run indexes                                  # dry run, every collection
 *   npm run indexes -- --only=materials_rolls        # dry run, one collection
 *   npm run indexes -- --only=materials_rolls --apply
 *
 * This exists because Mongoose never reconciles an existing index. It calls createIndex
 * with the new definition, Mongo sees the same name with different options and returns
 * IndexOptionsConflict, and Mongoose swallows it — so removing `unique` from a schema
 * changes nothing in the database and the old constraint keeps being enforced. That is a
 * silent failure: the service starts cleanly and rejects writes it should accept.
 *
 * `--apply` calls Model.syncIndexes(), which DROPS indexes the schema does not declare.
 * Read the dry run first — an index added by hand for a report is exactly what it will
 * remove.
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { logger } from "./logger";

// Importing for their side effect: a model has to be registered before it can be synced.
import "../models/MaterialRoll.model";
import "../models/StockTransaction.model";
import "../models/StockSummary.model";
import "../models/RawMaterial.model";
import "../models/Vendor.model";
import "../models/Location.model";
import "../models/SyncLog.model";
import "../models/User.model";

/** A stable description of one index, so two can be compared without ordering noise. */
function describe(key: Record<string, unknown>, opts: Record<string, unknown> = {}): string {
  const fields = Object.entries(key)
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  const flags = ["unique", "sparse"]
    .filter((f) => opts[f])
    .map((f) => ` ${f}`)
    .join("");
  return `{${fields}}${flags}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  // Scope it. syncIndexes drops whatever the schema does not declare, and a hand-made
  // index somebody added for a report looks exactly like drift — so reconciling one
  // collection at a time is the safe default, not a convenience.
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  let drift = 0;

  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    const collection = model.collection.collectionName;
    if (only && collection !== only) continue;

    // What the schema declares.
    const declared = new Map(
      model.schema
        .indexes()
        .map(([key, opts]) => [describe(key as Record<string, unknown>, opts ?? {}), true]),
    );

    // What the database actually has. _id is implicit and never declared.
    let existing: Array<{ name: string; key: Record<string, unknown>; unique?: boolean; sparse?: boolean }>;
    try {
      existing = (await model.collection.indexes()) as typeof existing;
    } catch {
      logger.info(`${collection}: collection does not exist yet — skipped`);
      continue;
    }

    const present = new Map(
      existing
        .filter((i) => i.name !== "_id_")
        .map((i) => [describe(i.key, { unique: i.unique, sparse: i.sparse }), i.name]),
    );

    const missing = [...declared.keys()].filter((d) => !present.has(d));
    const extra = [...present.entries()].filter(([d]) => !declared.has(d));

    if (!missing.length && !extra.length) continue;
    drift += missing.length + extra.length;

    logger.info(`${collection}:`);
    for (const m of missing) logger.info(`  + ${m}`);
    for (const [d, n] of extra) logger.info(`  - ${d}   (${n})   would be DROPPED`);

    if (apply) {
      const result = await model.syncIndexes();
      logger.info(`  applied — dropped: ${result.length ? result.join(", ") : "none"}`);
    }
  }

  if (!drift) logger.info("every collection already matches its schema.");
  else if (!apply) logger.info("\ndry run — nothing changed. Re-run with --apply to reconcile.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Index sync failed:", err);
  process.exit(1);
});
