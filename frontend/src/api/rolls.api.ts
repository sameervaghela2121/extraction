import { api } from "./client";
import type { MaterialRollListItem, Paginated } from "../types";

export const rollsApi = {
  list: (params: { q?: string; page?: number; pageSize?: number }) =>
    api
      .get<Paginated<MaterialRollListItem>>("/material-rolls", { params })
      .then((r) => r.data),
};
