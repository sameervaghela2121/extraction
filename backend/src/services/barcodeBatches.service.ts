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
      BarcodeBatch.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("createdBy", "name")
        .lean<IBarcodeBatch[]>(),
      BarcodeBatch.countDocuments(),
    ]);
    return {
      items: items.map(toResponse),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
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

  // A hard delete: a batch is a record of what was printed, not something other records
  // point at, so there is nothing for a soft delete to protect.
  async remove(id: string) {
    const batch = await findOr404(BarcodeBatch, id, "barcode batch");
    await batch.deleteOne();
    return { id };
  },
};
