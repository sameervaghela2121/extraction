import { api } from "./client";
import type { FieldDefinition } from "../types";

export const fieldDefinitionsApi = {
  list: () => api.get<FieldDefinition[]>("/field-definitions").then((r) => r.data),
  toggle: (key: string, enabled: boolean) =>
    api.patch<FieldDefinition>(`/field-definitions/${key}`, { enabled }).then((r) => r.data),
  addCustom: (label: string, description?: string) =>
    api.post<FieldDefinition>("/field-definitions", { label, description }).then((r) => r.data),
  remove: (key: string) => api.delete(`/field-definitions/${key}`).then((r) => r.data),
};
