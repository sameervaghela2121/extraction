import { call } from "./client";
import type { Paginated, StockMovement } from "../types";

export const stockApi = {
  /**
   * A roll's history. The ledger is append-only, so this IS the roll's history — there is
   * no history array on the roll itself.
   *
   * Newest first, and `total` is what tells you whether a roll has ever moved: registration
   * writes exactly one IN row, so a total of 1 means nothing has happened since it arrived.
   */
  movements: (params: { roll_id: string; page?: number; pageSize?: number }) =>
    call<Paginated<StockMovement>>("royal_touche.api.portal_rolls.movements", params),
};
