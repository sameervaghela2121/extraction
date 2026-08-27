/**
 * Load the location master from a JSON file.
 *
 *   npx tsx src/utils/seedLocations.ts                 # dry run, changes nothing
 *   npx tsx src/utils/seedLocations.ts --apply         # write
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * Idempotent — matched on location_code, and nothing is ever deleted: rolls and movements
 * record where stock sat, so a bay that closes is deactivated rather than removed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { Location } from "../models/Location.model";
import { logger } from "./logger";

const DEFAULT_FILE = "../docs/locations-seed.json";

type SeedLocation = {
  location_code: string;
  name: string;
  godown?: string;
  sort_order?: number;
  status?: "active" | "inactive";
};
type ParsedLocation = Required<Pick<SeedLocation, "location_code" | "name">> & {
  godown?: string;
  sort_order?: number;
  status: "active" | "inactive";
};

function parse(path: string): ParsedLocation[] {
  const rows: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${path} must contain an array`);

  const seen = new Set<string>();
  return rows.map((row, i) => {
    const v = row as SeedLocation;
    const where = `${path}[${i}]`;
    if (!v?.location_code?.trim()) throw new Error(`${where}: location_code is required`);
    if (!v?.name?.trim()) throw new Error(`${where}: name is required`);
    const code = v.location_code.trim().toUpperCase();
    if (seen.has(code)) throw new Error(`${where}: duplicate location_code ${code}`);
    seen.add(code);
    return {
      location_code: code,
      name: v.name.trim(),
      godown: v.godown?.trim() || undefined,
      sort_order: v.sort_order,
      status: v.status ?? "active",
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = resolve(args.find((a) => !a.startsWith("--")) ?? DEFAULT_FILE);

  const locations = parse(file);
  logger.info(`${locations.length} locations in ${file}`);

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  const existing = new Map(
    (await Location.find({}).lean()).map((l) => [l.location_code, l]),
  );
  const toCreate = locations.filter((l) => !existing.has(l.location_code));
  const toUpdate = locations.filter((l) => {
    const cur = existing.get(l.location_code);
    return (
      cur &&
      (cur.name !== l.name ||
        cur.godown !== l.godown ||
        cur.sort_order !== l.sort_order ||
        cur.status !== l.status)
    );
  });

  logger.info(
    `create ${toCreate.length}, update ${toUpdate.length}, unchanged ${locations.length - toCreate.length - toUpdate.length}`,
  );
  for (const l of toCreate) logger.info(`  + ${l.location_code}  ${l.name}`);
  for (const l of toUpdate) {
    logger.info(`  ~ ${l.location_code}  ${existing.get(l.location_code)!.name} -> ${l.name}`);
  }

  if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  } else if (toCreate.length || toUpdate.length) {
    const result = await Location.bulkWrite(
      locations.map((l) => ({
        updateOne: {
          filter: { location_code: l.location_code },
          update: {
            $set: { name: l.name, godown: l.godown, sort_order: l.sort_order, status: l.status },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    logger.info(`written: ${result.upsertedCount} created, ${result.modifiedCount} updated`);
  } else {
    logger.info("nothing to do — the database already matches the file.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Location seed failed:", err);
  process.exit(1);
});
