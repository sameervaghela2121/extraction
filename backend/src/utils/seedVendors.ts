/**
 * Load the vendor master from a JSON file.
 *
 *   npx tsx src/utils/seedVendors.ts                 # dry run, changes nothing
 *   npx tsx src/utils/seedVendors.ts --apply         # write
 *   npx tsx src/utils/seedVendors.ts --apply path/to/other.json
 *
 * Dry run is the default on purpose: this writes to whatever MONGODB_DB_NAME points at,
 * and .env points at production. Read the summary first, then re-run with --apply.
 *
 * Idempotent — matched on vendor_code, so re-running after fixing a name updates that
 * vendor rather than creating a second one. Nothing is ever deleted: a vendor that
 * disappears from the file is left alone, because rolls already reference it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { Vendor } from "../models/Vendor.model";
import { logger } from "./logger";

const DEFAULT_FILE = "../docs/vendors-seed.json";

type SeedPaper = {
  royal_touche_code?: string;
  delta_code?: string;
  is_common?: boolean;
  supplier_code_number?: string;
  found_in?: string;
};
type SeedVendor = {
  vendor_code: string;
  name: string;
  status?: "active" | "inactive";
  papers?: SeedPaper[];
};

/** What comes out of parse: defaults filled in, so the rest of the file has no optionals. */
type ParsedVendor = {
  vendor_code: string;
  name: string;
  status: "active" | "inactive";
  papers: SeedPaper[];
};

/** Fail on the file rather than on the 40th insert: a bad row here is a typo in the sheet. */
function parse(path: string): ParsedVendor[] {
  const rows: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${path} must contain an array`);

  const seen = new Set<string>();
  return rows.map((row, i) => {
    const v = row as SeedVendor;
    const where = `${path}[${i}]`;
    if (!v?.vendor_code?.trim()) throw new Error(`${where}: vendor_code is required`);
    if (!v?.name?.trim()) throw new Error(`${where}: name is required`);
    const code = v.vendor_code.trim().toUpperCase();
    if (seen.has(code)) throw new Error(`${where}: duplicate vendor_code ${code}`);
    seen.add(code);

    const papers = (v.papers ?? []).map((p, j) => {
      // A Delta-range paper has no RT code. One of the two is still required — a paper
      // with neither identifies nothing.
      if (!p?.royal_touche_code?.toString().trim() && !p?.delta_code?.toString().trim()) {
        throw new Error(`${where}.papers[${j}]: needs a royal_touche_code or a delta_code`);
      }
      return {
        royal_touche_code: p.royal_touche_code?.toString().trim().toUpperCase() || undefined,
        delta_code: p.delta_code?.toString().trim().toUpperCase() || undefined,
        is_common: p.is_common || undefined,
        supplier_code_number: p.supplier_code_number?.toString().trim() || undefined,
        found_in: p.found_in?.toString().trim() || undefined,
      };
    });

    return { vendor_code: code, name: v.name.trim(), status: v.status ?? "active", papers };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = resolve(args.find((a) => !a.startsWith("--")) ?? DEFAULT_FILE);

  const vendors = parse(file);
  const paperTotal = vendors.reduce((n, v) => n + v.papers.length, 0);
  logger.info(`${vendors.length} vendors, ${paperTotal} papers in ${file}`);

  await connectDb();
  logger.info(`database: ${mongoose.connection.name}`);

  const existing = new Map(
    (await Vendor.find({}).select("vendor_code name status papers").lean()).map((v) => [
      v.vendor_code,
      v,
    ]),
  );

  // Compared as a whole rather than row by row: the sheet is the source of truth for a
  // vendor's papers, so "different" means "replace the list", and there is nothing to
  // merge. Both codes, because a Delta-range paper has no RT code and would otherwise
  // compare equal to every other one.
  const paperCodes = (papers?: { royal_touche_code?: string; delta_code?: string }[]) =>
    (papers ?? []).map((p) => `${p.royal_touche_code ?? ""}/${p.delta_code ?? ""}`).join(",");

  const toCreate = vendors.filter((v) => !existing.has(v.vendor_code));
  const toUpdate = vendors.filter((v) => {
    const cur = existing.get(v.vendor_code);
    return (
      cur &&
      (cur.name !== v.name ||
        cur.status !== v.status ||
        paperCodes(cur.papers) !== paperCodes(v.papers))
    );
  });

  logger.info(`create ${toCreate.length}, update ${toUpdate.length}, unchanged ${vendors.length - toCreate.length - toUpdate.length}`);
  for (const v of toCreate.slice(0, 10)) {
    logger.info(`  + ${v.vendor_code}  ${v.name}  (${v.papers.length} papers)`);
  }
  if (toCreate.length > 10) logger.info(`  … and ${toCreate.length - 10} more`);
  for (const v of toUpdate) {
    const cur = existing.get(v.vendor_code)!;
    const papers =
      paperCodes(cur.papers) === paperCodes(v.papers)
        ? ""
        : `  papers ${(cur.papers ?? []).length} -> ${v.papers.length}`;
    logger.info(`  ~ ${v.vendor_code}  ${cur.name} -> ${v.name}${papers}`);
  }

  if (!apply) {
    logger.info("dry run — nothing written. Re-run with --apply to write.");
  } else if (toCreate.length || toUpdate.length) {
    // One round trip rather than 68. ordered:false so one bad row does not abandon the rest.
    const result = await Vendor.bulkWrite(
      vendors.map((v) => ({
        updateOne: {
          filter: { vendor_code: v.vendor_code },
          // $set only the fields the sheet owns — a vendor that has since gained an
          // address or GST number in the portal keeps them.
          update: { $set: { name: v.name, status: v.status, papers: v.papers } },
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
  logger.error("Vendor seed failed:", err);
  process.exit(1);
});
