import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDb } from "../config/db";
import { User } from "../models/User.model";
import { Supplier } from "../models/Supplier.model";
import { Material } from "../models/Material.model";
import { Location } from "../models/Location.model";
import { Client } from "../models/Client.model";
import { Batch } from "../models/Batch.model";
import { Roll } from "../models/Roll.model";
import { nextSequence } from "../models/Counter.model";
import { formatBarcodeId } from "./barcode";
import { parseLabelDate } from "./labelUnits";
import { SUPPLIERS, MATERIALS, LOCATIONS, CLIENTS, BATCHES, ROLLS } from "./seedData";
import { logger } from "./logger";

const SEED_EMPLOYEE_ID = (process.env.SEED_EMPLOYEE_ID ?? "EMP001").toUpperCase();
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? "royal@123";
const SEED_NAME = process.env.SEED_USER_NAME ?? "Royal Touch Operator";

/**
 * Idempotent: every step looks for the row first and only creates what is missing, so
 * `npm run seed` can be re-run against a partly-populated database without duplicating.
 *
 * Documents are created with `.create()` rather than upserted, because Material's
 * materialKey is derived in a pre("validate") hook that findOneAndUpdate would skip.
 */
async function main() {
  await connectDb();

  const user =
    (await User.findOne({ employeeId: SEED_EMPLOYEE_ID })) ??
    (await User.create({
      employeeId: SEED_EMPLOYEE_ID,
      name: SEED_NAME,
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
    }));
  logger.info(`user: ${user.employeeId} / ${SEED_PASSWORD}`);

  const supplierByCode = new Map<string, mongoose.Types.ObjectId>();
  for (const data of SUPPLIERS) {
    const supplier = (await Supplier.findOne({ code: data.code })) ?? (await Supplier.create(data));
    supplierByCode.set(data.code, supplier._id);
  }
  logger.info(`suppliers: ${supplierByCode.size}`);

  const materialBySku = new Map<string, { id: mongoose.Types.ObjectId; supplierCode: string }>();
  for (const data of MATERIALS) {
    const supplierId = supplierByCode.get(data.supplierCode)!;
    const material =
      (await Material.findOne({ sku: data.sku })) ??
      (await Material.create({ ...data, supplierId }));
    materialBySku.set(data.sku, { id: material._id, supplierCode: data.supplierCode });
  }
  logger.info(`materials: ${materialBySku.size}`);

  const locationByCode = new Map<string, mongoose.Types.ObjectId>();
  for (const data of LOCATIONS) {
    const location = (await Location.findOne({ code: data.code })) ?? (await Location.create(data));
    locationByCode.set(data.code, location._id);
  }
  logger.info(`locations: ${locationByCode.size}`);

  for (const data of CLIENTS) {
    if (!(await Client.findOne({ code: data.code }))) await Client.create(data);
  }
  // Backfill for rows created before nameKey existed. Without it those documents index as
  // null, and more than one null breaks the unique index the find-or-create relies on.
  for (const client of await Client.find({ nameKey: { $exists: false } })) {
    await client.save(); // pre("validate") derives nameKey
  }
  logger.info(`clients: ${CLIENTS.length}`);

  const batchByCode = new Map<string, mongoose.Types.ObjectId>();
  for (const data of BATCHES) {
    const supplierId = supplierByCode.get(data.supplierCode)!;
    const batch =
      (await Batch.findOne({ supplierId, code: data.code })) ??
      (await Batch.create({ code: data.code, supplierId, receivedDate: new Date() }));
    batchByCode.set(data.code, batch._id);
  }
  logger.info(`batches: ${batchByCode.size}`);

  let created = 0;
  for (const data of ROLLS) {
    const material = materialBySku.get(data.sku)!;
    // Keyed on the supplier's own roll number so re-running the seed doesn't mint a
    // second barcode for the same physical roll.
    if (await Roll.findOne({ supplierRollNo: data.supplierRollNo })) continue;

    const { sku, batchCode, locationCode, productionDate, ...rest } = data;
    await Roll.create({
      ...rest,
      barcodeId: formatBarcodeId(await nextSequence("rollBarcode")),
      materialId: material.id,
      supplierId: supplierByCode.get(material.supplierCode)!,
      currentWeightKg: data.receivedWeightKg,
      batchId: batchByCode.get(batchCode),
      locationId: locationByCode.get(locationCode),
      productionDate: parseLabelDate(productionDate) ?? undefined,
      receivedDate: new Date(),
      status: "IN_STOCK",
      registeredBy: user._id,
    });
    created += 1;
  }
  logger.info(`rolls: ${created} created, ${ROLLS.length - created} already present`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error("Seed failed:", err);
  process.exit(1);
});
