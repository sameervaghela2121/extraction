import { api } from "./client";
import type { ManagedUser, Paginated, UserRole, UserStatus } from "../types";
import type { SearchQuery } from "./masters.api";

export const usersApi = {
  list: () => api.get<ManagedUser[]>("/users").then((r) => r.data),
  /** The paged, server-searched user table. */
  search: (query: SearchQuery) =>
    api.post<Paginated<ManagedUser>>("/users/search", query).then((r) => r.data),
  /** Add a user with a password — created active, no email sent. */
  create: (body: { name: string; email: string; role: UserRole; password: string }) =>
    api.post<ManagedUser>("/users", body).then((r) => r.data),
  /** Replace a user's password; the old one isn't needed. */
  setPassword: (id: string, password: string) =>
    api.post<{ id: string; status: UserStatus }>(`/users/${id}/password`, { password }).then((r) => r.data),
  invite: (name: string, email: string, role: UserRole) =>
    api.post<ManagedUser>("/users/invite", { name, email, role }).then((r) => r.data),
  update: (id: string, updates: { role?: UserRole; status?: UserStatus }) =>
    api.patch<ManagedUser>(`/users/${id}`, updates).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};
