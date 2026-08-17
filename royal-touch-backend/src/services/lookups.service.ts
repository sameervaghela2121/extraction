import { Types } from "mongoose";
import { Location } from "../models/Location.model";
import { Batch } from "../models/Batch.model";
import { Client } from "../models/Client.model";
import { Supplier } from "../models/Supplier.model";
import { escapeRegex } from "../utils/escapeRegex";

/**
 * Master data for the app's dropdowns.
 *
 * These are read-only lists of a few dozen rows each, so there is no pagination envelope —
 * a dropdown wants an array, not a page. `LOOKUP_LIMIT` is a backstop against a list that
 * grows unexpectedly (batches will, over years), not a paging mechanism: past that point
 * the caller is expected to search.
 */
const LOOKUP_LIMIT = 200;

function searchFilter(search: string | undefined, fields: string[]): Record<string, unknown> {
  if (!search) return {};
  const pattern = new RegExp(escapeRegex(search), "i");
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}

export const lookupsService = {
  /** GET /locations — the rack/zone picker on registration and return. */
  async locations(search?: string) {
    const locations = await Location.find({ isActive: true, ...searchFilter(search, ["code", "name"]) })
      .sort({ code: 1 })
      .limit(LOOKUP_LIMIT);

    return locations.map((location) => ({
      id: location._id.toString(),
      code: location.code,
      name: location.name ?? null,
      zone: location.zone ?? null,
      rack: location.rack ?? null,
      shelf: location.shelf ?? null,
    }));
  },

  /**
   * GET /batches — optionally scoped to one supplier.
   *
   * Batch codes are only unique per supplier (two suppliers reuse the same order numbers),
   * so an unscoped list can legitimately contain the same code twice. The supplier filter
   * is what the registration screen actually uses, once a material has been chosen.
   */
  async batches(supplierId?: string, search?: string) {
    const filter: Record<string, unknown> = {
      isActive: true,
      ...searchFilter(search, ["code"]),
    };
    if (supplierId) filter.supplierId = new Types.ObjectId(supplierId);

    const batches = await Batch.find(filter)
      .sort({ receivedDate: -1, code: 1 })
      .limit(LOOKUP_LIMIT)
      .populate<{ supplierId: { _id: Types.ObjectId; name: string } }>("supplierId", "name");

    return batches.map((batch) => ({
      id: batch._id.toString(),
      code: batch.code,
      supplierId: batch.supplierId._id.toString(),
      supplierName: batch.supplierId.name,
      receivedDate: batch.receivedDate ?? null,
    }));
  },

  /** GET /clients — who a roll can be issued to. */
  async clients(search?: string) {
    const clients = await Client.find({ isActive: true, ...searchFilter(search, ["code", "name"]) })
      .sort({ name: 1 })
      .limit(LOOKUP_LIMIT);

    return clients.map((client) => ({
      id: client._id.toString(),
      code: client.code,
      name: client.name,
    }));
  },

  /** GET /suppliers — needed when a material has to be created for an unseen label. */
  async suppliers(search?: string) {
    const suppliers = await Supplier.find({
      isActive: true,
      ...searchFilter(search, ["code", "name"]),
    })
      .sort({ name: 1 })
      .limit(LOOKUP_LIMIT);

    return suppliers.map((supplier) => ({
      id: supplier._id.toString(),
      code: supplier.code,
      name: supplier.name,
      country: supplier.country ?? null,
    }));
  },
};
