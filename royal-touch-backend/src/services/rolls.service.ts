import mongoose, { Types } from "mongoose";
import { Roll, type IRoll } from "../models/Roll.model";
import { RollIssue } from "../models/RollIssue.model";
import { Material } from "../models/Material.model";
import { Client } from "../models/Client.model";
import { nextSequence } from "../models/Counter.model";
import { ApiError } from "../utils/ApiError";
import { escapeRegex } from "../utils/escapeRegex";
import { formatBarcodeId, buildZpl } from "../utils/barcode";
import { settleReturn } from "../utils/consumption";
import { mediaService } from "./media.service";

const BARCODE_SEQUENCE = "rollBarcode";

async function toRollResponse(roll: IRoll) {
  return {
    id: roll._id.toString(),
    barcodeId: roll.barcodeId,
    materialId: roll.materialId.toString(),
    status: roll.status,
    receivedWeightKg: roll.receivedWeightKg,
    currentWeightKg: roll.currentWeightKg,
    grossWeightKg: roll.grossWeightKg ?? null,
    netWeightKg: roll.netWeightKg ?? null,
    chargeableWeightKg: roll.chargeableWeightKg ?? null,
    lengthM: roll.lengthM ?? null,
    diameterMm: roll.diameterMm ?? null,
    splices: roll.splices ?? null,
    supplierRollNo: roll.supplierRollNo ?? null,
    supplierOrderNo: roll.supplierOrderNo ?? null,
    supplierBarcodeValue: roll.supplierBarcodeValue ?? null,
    batchId: roll.batchId?.toString() ?? null,
    locationId: roll.locationId?.toString() ?? null,
    productionDate: roll.productionDate ?? null,
    receivedDate: roll.receivedDate,
    // Minted per response: what is stored is an object path, because a signed URL would
    // have expired long before anyone opened the roll again.
    tagPhotoUrl: await mediaService.signedReadUrlOrNull(roll.tagPhotoPath),
    stitchedBarcodePhotoUrl: await mediaService.signedReadUrlOrNull(roll.stitchedBarcodePhotoPath),
    side1PhotoUrl: await mediaService.signedReadUrlOrNull(roll.side1PhotoPath),
    side2PhotoUrl: await mediaService.signedReadUrlOrNull(roll.side2PhotoPath),
  };
}

async function findByBarcodeOrThrow(barcodeId: string) {
  const roll = await Roll.findOne({ barcodeId: barcodeId.toUpperCase() });
  if (!roll) throw ApiError.notFound("Roll not found");
  return roll;
}

export const rollsService = {
  /**
   * GET /rolls/search?query= — "is this roll already registered?"
   *
   * Matched against our barcode and both supplier references, because the operator may be
   * holding a roll that already has our sticker, or one whose only identifier is the
   * supplier's own printed code.
   */
  async search(query: string) {
    const pattern = new RegExp(`^${escapeRegex(query.trim())}$`, "i");
    const roll = await Roll.findOne({
      $or: [{ barcodeId: pattern }, { supplierBarcodeValue: pattern }, { supplierRollNo: pattern }],
    });
    return roll ? await toRollResponse(roll) : null;
  },

  /**
   * POST /rolls/barcode/generate
   *
   * Returns a number only — no Roll document is written. The app reserves a barcode at the
   * start of registration and may well abandon the flow; a row created here would leave a
   * half-registered roll behind. The counter guarantees the number is never reissued, so
   * an abandoned barcode is simply a gap.
   *
   * No barcodeImageUrl: Android renders Code 128 locally from the string (ZXing), which is
   * faster than a round-trip and works with no signal on the warehouse floor.
   */
  async generateBarcode() {
    const sequence = await nextSequence(BARCODE_SEQUENCE);
    return { barcodeId: formatBarcodeId(sequence) };
  },

  /** POST /rolls — the Final Confirmation submit. */
  async create(input: {
    barcodeId: string;
    materialId: string;
    receivedWeightKg: number;
    grossWeightKg?: number;
    netWeightKg?: number;
    chargeableWeightKg?: number;
    lengthM?: number;
    diameterMm?: number;
    splices?: number;
    areaM2?: number;
    supplierRollNo?: string;
    supplierOrderNo?: string;
    supplierReferenceNo?: string;
    soNumber?: string;
    ceNumber?: string;
    supplierBarcodeValue?: string;
    batchId?: string;
    locationId?: string;
    productionDate?: Date;
    packingDate?: Date;
    tagPhotoPath?: string;
    stitchedBarcodePhotoPath?: string;
    side1PhotoPath?: string;
    side2PhotoPath?: string;
    ocrRawText?: string;
    registeredBy: string;
  }) {
    const material = await Material.findById(input.materialId);
    if (!material || !material.isActive) throw ApiError.badRequest("Unknown material");

    const barcodeId = input.barcodeId.toUpperCase();
    if (await Roll.exists({ barcodeId })) {
      throw ApiError.conflict("A roll with this barcode is already registered");
    }

    try {
      const roll = await Roll.create({
        ...input,
        barcodeId,
        materialId: material._id,
        // Taken from the material, not the request: the supplier owns the roll's identity
        // for duplicate detection and a client must not be able to reassign it.
        supplierId: material.supplierId,
        // A newly received roll is full — the two only diverge once it starts being issued.
        currentWeightKg: input.receivedWeightKg,
        batchId: input.batchId ? new Types.ObjectId(input.batchId) : undefined,
        locationId: input.locationId ? new Types.ObjectId(input.locationId) : undefined,
        registeredBy: new Types.ObjectId(input.registeredBy),
        status: "IN_STOCK",
      });
      return await toRollResponse(roll);
    } catch (err) {
      // The (supplierId, supplierBarcodeValue) unique index — this physical roll has been
      // received before, which is exactly what that index exists to catch.
      if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
        throw ApiError.conflict("This supplier roll has already been received");
      }
      throw err;
    }
  },

  /** GET /rolls/:barcodeId */
  async detail(barcodeId: string) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    const openIssue = roll.currentIssueId
      ? await RollIssue.findById(roll.currentIssueId).populate<{ clientId: { name: string } }>(
          "clientId",
          "name",
        )
      : null;

    return {
      ...(await toRollResponse(roll)),
      // Answers "where is this roll right now" in the same call the Scan tab already makes.
      issuedTo: openIssue ? { clientName: openIssue.clientId.name, since: openIssue.issuedAt } : null,
    };
  },

  /**
   * PATCH /rolls/:barcodeId/status with status=OUT — issue to a client.
   *
   * The issued weight is read from the roll, never from the request: a roll returned at 5kg
   * must go out at 5kg, and letting the caller name the weight would break reconciliation.
   */
  async issue(barcodeId: string, clientId: string, userId: string, locationId?: string) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    if (roll.status === "ISSUED") throw ApiError.conflict("This roll is already out with a client");
    if (roll.status === "CONSUMED") throw ApiError.conflict("This roll has been fully consumed");

    const client = await Client.findById(clientId);
    if (!client || !client.isActive) throw ApiError.badRequest("Unknown client");

    let issue;
    try {
      issue = await RollIssue.create({
        rollId: roll._id,
        clientId: client._id,
        issuedWeightKg: roll.currentWeightKg,
        issuedBy: new Types.ObjectId(userId),
        issuedFromLocationId: locationId ? new Types.ObjectId(locationId) : roll.locationId,
        status: "OPEN",
      });
    } catch (err) {
      // The partial unique index on { rollId, status: OPEN }. Two operators scanning the
      // same roll at once both pass the status check above; only one insert survives.
      if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
        throw ApiError.conflict("This roll is already out with a client");
      }
      throw err;
    }

    roll.status = "ISSUED";
    roll.currentIssueId = issue._id;
    await roll.save();

    return { rollId: roll._id.toString(), issueId: issue._id.toString(), status: roll.status };
  },

  /**
   * PATCH /rolls/:barcodeId/status with status=IN — the roll comes back, lighter.
   *
   * The difference between what went out and what came back is what the client consumed.
   * That subtraction is the only place consumption is ever computed.
   */
  async receiveBack(
    barcodeId: string,
    returnedWeightKg: number,
    userId: string,
    locationId?: string,
  ) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    if (roll.status !== "ISSUED" || !roll.currentIssueId) {
      throw ApiError.conflict("This roll is not currently out with a client");
    }

    const issue = await RollIssue.findById(roll.currentIssueId);
    if (!issue || issue.status !== "OPEN") {
      throw ApiError.conflict("No open issue found for this roll");
    }

    let outcome;
    try {
      outcome = settleReturn(issue.issuedWeightKg, returnedWeightKg);
    } catch (err) {
      // A roll cannot come back heavier than it left — a keying slip, not a server fault.
      throw ApiError.badRequest(err instanceof Error ? err.message : "Invalid returned weight");
    }

    issue.returnedWeightKg = returnedWeightKg;
    issue.returnedBy = new Types.ObjectId(userId);
    issue.returnedAt = new Date();
    if (locationId) issue.returnedToLocationId = new Types.ObjectId(locationId);
    issue.consumedKg = outcome.consumedKg;
    issue.status = outcome.status;
    await issue.save();

    // The scale at the office is the source of truth for what is left.
    roll.currentWeightKg = returnedWeightKg;
    roll.status = outcome.newRollStatus;
    roll.currentIssueId = undefined;
    if (locationId) roll.locationId = new Types.ObjectId(locationId);
    await roll.save();

    return {
      rollId: roll._id.toString(),
      status: roll.status,
      currentWeightKg: roll.currentWeightKg,
      consumedKg: outcome.consumedKg,
    };
  },

  /** GET /rolls/:barcodeId/history — every out-and-back cycle, newest first. */
  async history(barcodeId: string) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    const issues = await RollIssue.find({ rollId: roll._id })
      .sort({ issuedAt: -1 })
      .populate<{ clientId: { name: string } }>("clientId", "name");

    return issues.map((issue) => ({
      id: issue._id.toString(),
      clientName: issue.clientId.name,
      issuedWeightKg: issue.issuedWeightKg,
      issuedAt: issue.issuedAt,
      returnedWeightKg: issue.returnedWeightKg ?? null,
      returnedAt: issue.returnedAt ?? null,
      consumedKg: issue.consumedKg ?? null,
      status: issue.status,
    }));
  },

  /** GET /rolls/:barcodeId/barcode/print — ZPL for the paired Zebra printer. */
  async printPayload(barcodeId: string) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    const material = await Material.findById(roll.materialId);
    if (!material) throw ApiError.notFound("Material not found for this roll");

    return {
      barcodeId: roll.barcodeId,
      zpl: buildZpl({
        barcodeId: roll.barcodeId,
        materialName: material.name,
        widthMm: material.widthMm,
        gsm: material.gsm,
        weightKg: roll.currentWeightKg,
      }),
    };
  },
};
