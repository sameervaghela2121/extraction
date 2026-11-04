import { call } from "./client";
import type { AuthResult, AuthUser } from "../types";

interface ErpLogin {
  access_token: string;
  refresh_token: string;
  user: string;
  full_name: string;
  role: AuthUser["role"];
}

const toUser = (m: { user: string; full_name: string; role: AuthUser["role"] }): AuthUser => ({
  userId: m.user,
  role: m.role,
  name: m.full_name,
  email: m.user,
});

export const authApi = {
  login: (email: string, password: string) =>
    call<ErpLogin>("royal_touche.api.auth.login", { usr: email, pwd: password }, "POST").then(
      (m): AuthResult => ({ user: toUser(m), accessToken: m.access_token, refreshToken: m.refresh_token }),
    ),
  me: () => call<Omit<ErpLogin, "access_token" | "refresh_token">>("royal_touche.api.auth.me").then(toUser),
  acceptInvite: (token: string, password: string) =>
    call<ErpLogin>("royal_touche.api.portal_users.accept_invite", { token, password }, "POST").then(
      (m): AuthResult => ({ user: toUser(m), accessToken: m.access_token, refreshToken: m.refresh_token }),
    ),
  forgotPassword: (email: string) =>
    call<{ message: string }>("royal_touche.api.portal_users.forgot_password", { email }, "POST"),
  resetPassword: (token: string, password: string) =>
    call<ErpLogin>("royal_touche.api.portal_users.reset_password", { token, password }, "POST").then(
      (m): AuthResult => ({ user: toUser(m), accessToken: m.access_token, refreshToken: m.refresh_token }),
    ),
};
