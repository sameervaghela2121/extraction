import { api } from "./client";
import type { AuthResult, AuthUser } from "../types";

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResult>("/auth/login", { email, password }).then((r) => r.data),
  me: () => api.get<AuthUser>("/auth/me").then((r) => r.data),
  acceptInvite: (token: string, password: string) =>
    api.post<AuthResult>(`/auth/invite/${token}/accept`, { password }).then((r) => r.data),
  forgotPassword: (email: string) =>
    api.post<{ message: string }>("/auth/forgot-password", { email }).then((r) => r.data),
  resetPassword: (token: string, password: string) =>
    api.post<AuthResult>("/auth/reset-password", { token, password }).then((r) => r.data),
};
