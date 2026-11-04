import { call } from "./client";
import type { ManagedUser, Paginated, UserRole, UserStatus } from "../types";
import type { SearchQuery } from "./masters.api";

const M = "royal_touche.api.portal_users.";

export const usersApi = {
  list: () => call<ManagedUser[]>(`${M}list_users`),
  /** The paged, server-searched user table. */
  search: (query: SearchQuery) =>
    call<Paginated<ManagedUser>>(`${M}search`, {
      page: query.page,
      page_size: query.pageSize,
      q: query.q,
      sort: query.sort,
      order: query.order,
    }),
  /** Add a user with a password — created active, no email sent. */
  create: (body: { name: string; email: string; role: UserRole; password: string }) =>
    call<ManagedUser>(
      `${M}create`,
      { full_name: body.name, email: body.email, role: body.role, password: body.password },
      "POST",
    ),
  /** Replace a user's password; the old one isn't needed. */
  setPassword: (id: string, password: string) =>
    call<{ id: string; status: UserStatus }>(`${M}set_password`, { user: id, password }, "POST"),
  invite: (name: string, email: string, role: UserRole) =>
    call<ManagedUser>(`${M}invite`, { full_name: name, email, role }, "POST"),
  update: (id: string, updates: { role?: UserRole; status?: UserStatus }) =>
    call<ManagedUser>(`${M}update`, { user: id, role: updates.role, status: updates.status }, "POST"),
  remove: (id: string) => call<{ id: string; status: UserStatus }>(`${M}remove`, { user: id }, "POST"),
};
