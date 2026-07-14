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
