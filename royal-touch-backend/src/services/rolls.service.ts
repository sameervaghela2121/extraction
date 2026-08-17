import mongoose, { Types } from "mongoose";
import { Roll, type IRoll } from "../models/Roll.model";
import { RollIssue } from "../models/RollIssue.model";
import { Material } from "../models/Material.model";
import { Client } from "../models/Client.model";
import { nextSequence } from "../models/Counter.model";
import { ApiError } from "../utils/ApiError";
import { escapeRegex } from "../utils/escapeRegex";
import { formatBarcodeId, buildZpl } from "../utils/barcode";
import { settleReturn, WEIGHT_EPSILON_KG } from "../utils/consumption";
import { RollAdjustment } from "../models/RollAdjustment.model";
import { mediaService } from "./media.service";

const BARCODE_SEQUENCE = "rollBarcode";

/**
 * One movement of a roll. `weightKg` means what it weighed at that moment — received at,
 * issued at, or came back at — so the column reads consistently down the ledger.
 */
interface RollHistoryEvent {
  type: "RECEIVED" | "OUT" | "IN" | "ADJUSTED";
  at: Date;
  weightKg: number;
  clientName: string | null;
  consumedKg: number | null;
  byName: string | null;
  issueId: string | null;
  /** Only on ADJUSTED — why someone changed the figure. */
  reason?: string;
}

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

  /**
   * PATCH /rolls/:barcodeId/weight — correct the weight of a roll sitting in stock.
   *
   * Deliberately refused while the roll is ISSUED: the roll is not on the premises, so
   * nobody can have weighed it, and the return flow already captures the real figure. An
   * adjustment accepted mid-issue would also be double-counted, since consumption is
   * computed from the weight the roll left at.
   */
  async adjustWeight(
    barcodeId: string,
    newWeightKg: number,
    reason: string,
    userId: string,
  ) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    if (roll.status === "ISSUED") {
      throw ApiError.conflict(
        "This roll is out with a client — record the corrected weight when it is returned",
      );
    }
    if (roll.status === "CONSUMED") {
      throw ApiError.conflict("This roll has been fully consumed");
    }

    const previousWeightKg = roll.currentWeightKg;

    // Submitting the weight already on record is a confirmation, not a mistake — the
    // operator re-weighed and it matched. Nothing to store, nothing to complain about.
    if (Math.abs(newWeightKg - previousWeightKg) < WEIGHT_EPSILON_KG) {
      return {
        rollId: roll._id.toString(),
        status: roll.status,
        changed: false,
        message: "Weight is already up to date",
        previousWeightKg,
        currentWeightKg: previousWeightKg,
        deltaKg: 0,
      };
    }

    const adjustment = await RollAdjustment.create({
      rollId: roll._id,
      previousWeightKg,
      newWeightKg,
      deltaKg: newWeightKg - previousWeightKg,
      reason,
      adjustedBy: new Types.ObjectId(userId),
    });

    roll.currentWeightKg = newWeightKg;
    // A roll corrected to zero is spent, the same as one returned empty — leaving it
    // IN_STOCK would offer the operator a roll with nothing on it.
    if (newWeightKg <= WEIGHT_EPSILON_KG) roll.status = "CONSUMED";
    await roll.save();

    return {
      rollId: roll._id.toString(),
      status: roll.status,
      changed: true,
      message: "Weight updated",
      previousWeightKg,
      currentWeightKg: roll.currentWeightKg,
      deltaKg: adjustment.deltaKg,
    };
  },

  /**
   * GET /rolls/:barcodeId/history — every movement of this roll, newest first.
   *
   * One entry per event, not per cycle: the roll being received, each time it went out, and
   * each time it came back. A cycle row would hide the fact that a roll currently at a
   * client has left but not returned, and the screen this feeds is a ledger the operator
   * reads top-down.
   *
   * `issueId` pairs an IN with the OUT it closes, so the app can group them if it wants to.
   */
  async history(barcodeId: string) {
    const roll = await findByBarcodeOrThrow(barcodeId);
    await roll.populate<{ registeredBy: { name: string } }>("registeredBy", "name");

    const issues = await RollIssue.find({ rollId: roll._id })
      .sort({ issuedAt: 1 })
      .populate<{ clientId: { name: string } }>("clientId", "name")
      .populate<{ issuedBy: { name: string } }>("issuedBy", "name")
      .populate<{ returnedBy: { name: string } }>("returnedBy", "name");

    const events: RollHistoryEvent[] = [
      {
        type: "RECEIVED",
        at: roll.receivedDate,
        weightKg: roll.receivedWeightKg,
        clientName: null,
        consumedKg: null,
        byName: (roll.registeredBy as unknown as { name?: string })?.name ?? null,
        issueId: null,
      },
    ];

    for (const issue of issues) {
      events.push({
        type: "OUT",
        at: issue.issuedAt,
        weightKg: issue.issuedWeightKg,
        clientName: issue.clientId.name,
        consumedKg: null,
        byName: (issue.issuedBy as unknown as { name?: string })?.name ?? null,
        issueId: issue._id.toString(),
      });

      // Only once it is actually back — an OPEN issue has an OUT and no IN, which is
      // precisely what "still with the client" looks like on the screen.
      if (issue.returnedAt) {
        events.push({
          type: "IN",
          at: issue.returnedAt,
          weightKg: issue.returnedWeightKg ?? 0,
          clientName: issue.clientId.name,
          consumedKg: issue.consumedKg ?? null,
          byName: (issue.returnedBy as unknown as { name?: string })?.name ?? null,
          issueId: issue._id.toString(),
        });
      }
    }

    const adjustments = await RollAdjustment.find({ rollId: roll._id }).populate<{
      adjustedBy: { name: string };
    }>("adjustedBy", "name");

    for (const adjustment of adjustments) {
      events.push({
        type: "ADJUSTED",
        at: adjustment.adjustedAt,
        weightKg: adjustment.newWeightKg,
        clientName: null,
        // The delta, not a client's consumption — signed, so the ledger still adds up.
        consumedKg: adjustment.deltaKg,
        byName: (adjustment.adjustedBy as unknown as { name?: string })?.name ?? null,
        issueId: null,
        reason: adjustment.reason,
      });
    }

    return events.sort((a, b) => b.at.getTime() - a.at.getTime());
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
