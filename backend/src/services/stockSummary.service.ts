import { Types } from "mongoose";
import { MaterialRoll } from "../models/MaterialRoll.model";
import { StockSummary, type IStockSummary } from "../models/StockSummary.model";

/**
 * Recompute a material's cached totals from the rolls that actually exist.
 *
 * Lives in its own module because two things change stock: a movement, and the rolls
 * themselves being created or removed. Both must call this, and neither should have to
 * import the other's service to do it.
 *
 * Recomputed rather than $inc'd: the summary is a cache, and a cache that derives itself
 * can't drift out of step with the rolls it summarises.
 */
export async function refreshSummary(
  materialId: Types.ObjectId | string,
): Promise<IStockSummary> {
  const id = typeof materialId === "string" ? new Types.ObjectId(materialId) : materialId;

  const [agg] = await MaterialRoll.aggregate<{ total: number; rolls: number }>([
    // On hand means on the rack: a roll that has gone out to a line is not in the store,
    // so it drops out of the total until it comes back. Weight alone is not enough —
    // an ISSUED roll still has weight, it is just somewhere else.
    { $match: { material_id: id, status: "IN_STOCK", remaining_weight: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: "$remaining_weight" }, rolls: { $sum: 1 } } },
  ]);

  return StockSummary.findOneAndUpdate(
    { material_id: id },
    {
      $set: {
        total_weight: agg?.total ?? 0,
        total_rolls: agg?.rolls ?? 0,
        last_updated: new Date(),
      },
    },
    { new: true, upsert: true },
  );
}

/** Refresh several materials at once — used when a roll moves between materials. */
export async function refreshSummaries(
  materialIds: Array<Types.ObjectId | string>,
): Promise<void> {
  const unique = [...new Set(materialIds.map((id) => id.toString()))];
  await Promise.all(unique.map((id) => refreshSummary(id)));
}
