import { z } from "zod";
import { BARCODE_ID_PATTERN } from "../utils/barcode";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const weightKg = z.coerce.number().nonnegative().finite();
const mediaPath = z.string().trim().regex(/^rolls\/\d{4}\/\d{2}\/[\w-]+\.[a-z]{2,8}$/, "Invalid media path");

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1),
});

export const barcodeParamsSchema = z.object({
  barcodeId: z.string().trim().regex(BARCODE_ID_PATTERN, "Invalid barcode"),
});

export const createRollSchema = z.object({
  barcodeId: z.string().trim().regex(BARCODE_ID_PATTERN, "Invalid barcode"),
  materialId: objectId,
  // The canonical stock figure — net when the label prints one, gross otherwise. The app
  // resolves that before submitting; the server stores what it is told alongside the raw
  // supplier numbers.
  receivedWeightKg: weightKg.positive(),
  grossWeightKg: weightKg.optional(),
  netWeightKg: weightKg.optional(),
  chargeableWeightKg: weightKg.optional(),
  lengthM: weightKg.optional(),
  diameterMm: weightKg.optional(),
  splices: z.coerce.number().int().nonnegative().optional(),
  areaM2: weightKg.optional(),
  supplierRollNo: z.string().trim().optional(),
  supplierOrderNo: z.string().trim().optional(),
  supplierReferenceNo: z.string().trim().optional(),
  soNumber: z.string().trim().optional(),
  ceNumber: z.string().trim().optional(),
  supplierBarcodeValue: z.string().trim().optional(),
  batchId: objectId.optional(),
  locationId: objectId.optional(),
  productionDate: z.coerce.date().optional(),
  packingDate: z.coerce.date().optional(),
  // Object paths returned by POST /media/upload, not URLs — the app echoes back what the
  // upload gave it. Constrained to the rolls/ prefix so a caller cannot point a roll at an
  // arbitrary object elsewhere in the bucket.
  tagPhotoPath: mediaPath.optional(),
  stitchedBarcodePhotoPath: mediaPath.optional(),
  side1PhotoPath: mediaPath.optional(),
  side2PhotoPath: mediaPath.optional(),
  ocrRawText: z.string().optional(),
});

/**
 * A correction to a roll sitting in stock. The reason is mandatory and free text: the person
 * reading this in six months needs to know whether 40kg was written off as damage or simply
 * mis-keyed at registration.
 */
export const adjustWeightSchema = z.object({
  currentWeightKg: weightKg,
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

/**
 * OUT and IN carry different payloads — OUT needs the client, IN needs what came back on
 * the scale. A discriminated union rejects the wrong combination at the boundary rather
 * than leaving the service to guess.
 */
export const updateStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("OUT"),
    clientId: objectId,
    locationId: objectId.optional(),
  }),
  z.object({
    status: z.literal("IN"),
    // Zero is valid and meaningful: the client used the whole roll.
    returnedWeightKg: weightKg,
    locationId: objectId.optional(),
  }),
]);
