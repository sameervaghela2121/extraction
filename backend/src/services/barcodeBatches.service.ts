import { Types } from "mongoose";
import { BarcodeBatch, type IBarcodeBatch } from "../models/BarcodeBatch.model";
import { findOr404 } from "../utils/crud";
import { ApiError } from "../utils/ApiError";
import type { AuthPayload } from "../types/express";

const DEFAULT_PAGE_SIZE = 20;

type BatchInput = {
  prefix: string;
  date: string;
  from_number: number;
  to_number: number;
};

function toResponse(b: IBarcodeBatch & { createdBy?: unknown }) {
  const creator = b.createdBy as { name?: string } | Types.ObjectId | null;
  return {
    id: b._id.toString(),
    prefix: b.prefix,
    date: b.date,
    from_number: b.from_number,
    to_number: b.to_number,
    count: b.to_number - b.from_number + 1,
    createdBy: creator && "name" in creator ? (creator.name ?? "—") : "—",
    createdAt: b.createdAt,
  };
}

export const barcodeBatchesService = {
  async list(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const [items, total] = await Promise.all([
      BarcodeBatch.find({ deleted_at: null })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("createdBy", "name")
        .lean<IBarcodeBatch[]>(),
      BarcodeBatch.countDocuments({ deleted_at: null }),
    ]);
    return {
      items: items.map(toResponse),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  /**
   * Where the next run for this prefix and date should start.
   *
   * A code is prefix + YYMMDD + sequence, so a number only has to be unique within one
   * prefix on one date — which is exactly what is filtered here.
   *
   * Deleted runs count. Their labels were printed and are on rolls somewhere, so the
   * counter must never rewind past them. This is also why the client no longer works this
   * out from the runs it happens to have loaded: that list is paginated and hides removed
   * runs, so it could only ever see part of the answer.
   */
  async nextNumber(prefix: string, date: string) {
    const highest = await BarcodeBatch.findOne({
      prefix: prefix.trim().toUpperCase(),
      date: date.trim(),
    })
      .sort({ to_number: -1 })
      .select("to_number")
      .lean();
    return { next: (highest?.to_number ?? 0) + 1 };
  },

  async create(input: BatchInput, auth: AuthPayload) {
    // Normalise here, not just in the schema: the duplicate check is a query, and it has
    // to compare against the same shape the unique index stores.
    const values = { ...input, prefix: input.prefix.trim().toUpperCase(), date: input.date.trim() };
    const duplicate = "That exact run has already been saved";
    if (await BarcodeBatch.exists(values)) throw ApiError.conflict(duplicate);
    try {
      const batch = await BarcodeBatch.create({
        ...values,
        createdBy: new Types.ObjectId(auth.userId),
      });
      // Populate before responding: the list shows a name, and a freshly created row
      // would otherwise sit there as "—" until the page is reloaded.
      await batch.populate("createdBy", "name");
      return toResponse(batch);
    } catch (err) {
      // Two clicks landing together: the check above passes twice, the index rejects one.
      if ((err as { code?: number }).code === 11000) throw ApiError.conflict(duplicate);
      throw err;
    }
  },

  /**
   * Soft, and deliberately so.
   *
   * The row is a record of numbers that were physically printed. Removing it used to let
   * nextNumber hand those same codes out again — two rolls carrying one barcode, which is
   * unrecoverable once they are in the godown. The run leaves the list; the numbers stay
   * spent.
   */
  async remove(id: string) {
    const batch = await findOr404(BarcodeBatch, id, "barcode batch");
    if (!batch.deleted_at) {
      batch.deleted_at = new Date();
      await batch.save();
    }
    return { id };
  },
};
