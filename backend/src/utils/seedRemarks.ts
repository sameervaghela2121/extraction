/**
 * Load the remark master from a JSON file.
 *
 *   npx tsx src/utils/seedRemarks.ts                 # dry run, changes nothing
 *   npx tsx src/utils/seedRemarks.ts --apply         # write
 *
 * Dry run is the default on purpose: .env points at production. Read the summary first.
 *
 * Idempotent — matched on remark_code, and nothing is ever deleted: movements record the
 * remark they were given, so a remark that falls out of use is deactivated, not removed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { Remark } from "../models/Remark.model";
import { logger } from "./logger";

const DEFAULT_FILE = "../docs/remarks-seed.json";

type SeedRemark = {
  remark_code: string;
  label: string;
  sort_order?: number;
  status?: "active" | "inactive";
};
type ParsedRemark = Required<Pick<SeedRemark, "remark_code" | "label">> & {
  sort_order?: number;
  status: "active" | "inactive";
};

function parse(path: string): ParsedRemark[] {
  const rows: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${path} must contain an array`);

  const seen = new Set<string>();
  return rows.map((row, i) => {
    const v = row as SeedRemark;
    const where = `${path}[${i}]`;
    if (!v?.remark_code?.trim()) throw new Error(`${where}: remark_code is required`);
    if (!v?.label?.trim()) throw new Error(`${where}: label is required`);
    const code = v.remark_code.trim().toUpperCase();
    if (seen.has(code)) throw new Error(`${where}: duplicate remark_code ${code}`);
    seen.add(code);
    return {
      remark_code: code,
      label: v.label.trim(),
      sort_order: v.sort_order,
      status: v.status ?? "active",
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = resolve(args.find((a) => !a.startsWith("--")) ?? DEFAULT_FILE);

  const remarks = parse(file);
  logger.info(`${remarks.length} remarks in ${file}`);

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  const existing = new Map((await Remark.find({}).lean()).map((r) => [r.remark_code, r]));
  const toCreate = remarks.filter((r) => !existing.has(r.remark_code));
  const toUpdate = remarks.filter((r) => {
    const cur = existing.get(r.remark_code);
    return (
      cur && (cur.label !== r.label || cur.sort_order !== r.sort_order || cur.status !== r.status)
    );
  });

  logger.info(
    `create ${toCreate.length}, update ${toUpdate.length}, unchanged ${remarks.length - toCreate.length - toUpdate.length}`,
  );
  for (const r of toCreate) logger.info(`  + ${r.remark_code}  ${r.label}`);
  for (const r of toUpdate) {
    logger.info(`  ~ ${r.remark_code}  ${existing.get(r.remark_code)!.label} -> ${r.label}`);
  }

  if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  } else if (toCreate.length || toUpdate.length) {
    const result = await Remark.bulkWrite(
      remarks.map((r) => ({
        updateOne: {
          filter: { remark_code: r.remark_code },
          update: { $set: { label: r.label, sort_order: r.sort_order, status: r.status } },
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
  logger.error("Remark seed failed:", err);
  process.exit(1);
});
