import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
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

/** Mirrors AppLayout's nav filtering, but at the route level — hiding the nav link
 *  doesn't stop staff typing /documents (or /export, /upload, …) into the address bar.
 *  Admins pass through untouched. */
export function StaffRestrictedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user?.role === "staff") return <Navigate to="/grn" replace />;
  return <Outlet />;
}

/** Landing target for "/" and unmatched paths — role-aware so staff don't get bounced
 *  through /documents (which StaffRestrictedRoute would immediately kick them back out of). */
export function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading DocFlow…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "staff" ? "/grn" : "/documents"} replace />;
}
