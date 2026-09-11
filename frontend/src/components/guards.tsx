import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { UserRole } from "../types";
import { Spinner } from "./ui";

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading DocFlow…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AdminRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user?.role !== "admin" && user?.role !== "super_admin") {
    return <Navigate to={homeForRole(user?.role)} replace />;
  }
  return <Outlet />;
}

/** Where a role lands when it has no business on the page it asked for, or right after
 *  login/invite/reset (see LoginPage, AcceptInvitePage, ResetPasswordPage — all three call
 *  homeForRole instead of hardcoding a path, so there is exactly one place to update when
 *  a section is temporarily disabled).
 *
 *  /upload, /documents, /grn, /grn/new, /general-vouchers*, /export and /settings are
 *  commented out in router.tsx for now — restore their entries there and revert staff back
 *  to "/grn" together. Admins are absent from this list because they're allowed everywhere
 *  that isn't explicitly disabled. */
const HOME_FOR_ROLE: Partial<Record<UserRole, string>> = {
  staff: "/no-access",
  godown_supervisor: "/masters",
  admin: "/users",
  super_admin: "/users",
};

/** Safe even for a role with no entry above, or none at all (loading/logged-out edge). Never
 *  points at a route that might itself be disabled — /users is the one page every web role
 *  in HOME_FOR_ROLE can actually reach right now. */
function homeForRole(role?: UserRole): string {
  return (role && HOME_FOR_ROLE[role]) ?? "/users";
}

/** Mirrors AppLayout's nav filtering, but at the route level — hiding the nav link doesn't
 *  stop someone typing /documents (or /export, /upload, …) into the address bar. Give it
 *  either a deny list or an allow list; a rejected role goes to its own home section. */
export function RoleRoute({ deny, allow }: { deny?: UserRole[]; allow?: UserRole[] }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  // super_admin passes every allow/deny list, same as AppLayout's nav filter and the
  // backend's requireRole — it has no ceiling, so no per-list membership to maintain.
  const rejected =
    user.role !== "super_admin" &&
    (allow ? !allow.includes(user.role) : Boolean(deny?.includes(user.role)));
  if (rejected) return <Navigate to={homeForRole(user.role)} replace />;
  return <Outlet />;
}

/** Landing target for "/" and unmatched paths — role-aware so nobody gets bounced through
 *  a page RoleRoute would immediately kick them back out of. */
export function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading DocFlow…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

export { homeForRole };
