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
  if (user?.role !== "admin") return <Navigate to="/documents" replace />;
  return <Outlet />;
}

/** Where a role lands when it has no business on the page it asked for. Admins are absent
 *  because they're allowed everywhere. */
const HOME_FOR_ROLE: Partial<Record<UserRole, string>> = {
  staff: "/grn",
  godown_supervisor: "/masters",
};

/** Mirrors AppLayout's nav filtering, but at the route level — hiding the nav link doesn't
 *  stop someone typing /documents (or /export, /upload, …) into the address bar. Give it
 *  either a deny list or an allow list; a rejected role goes to its own home section. */
export function RoleRoute({ deny, allow }: { deny?: UserRole[]; allow?: UserRole[] }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  const rejected = allow ? !allow.includes(user.role) : Boolean(deny?.includes(user.role));
  if (rejected) return <Navigate to={HOME_FOR_ROLE[user.role] ?? "/documents"} replace />;
  return <Outlet />;
}

/** Landing target for "/" and unmatched paths — role-aware so nobody gets bounced through
 *  /documents (which RoleRoute would immediately kick them back out of). */
export function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading DocFlow…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_FOR_ROLE[user.role] ?? "/documents"} replace />;
}
