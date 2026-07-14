import { api } from "./client";
import type { ManagedUser, UserRole, UserStatus } from "../types";

export const usersApi = {
  list: () => api.get<ManagedUser[]>("/users").then((r) => r.data),
  invite: (name: string, email: string, role: UserRole) =>
    api.post<ManagedUser>("/users/invite", { name, email, role }).then((r) => r.data),
  update: (id: string, updates: { role?: UserRole; status?: UserStatus }) =>
    api.patch<ManagedUser>(`/users/${id}`, updates).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};
