import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import { ProtectedRoute, AdminRoute } from "./components/guards";
import LoginPage from "./features/auth/LoginPage";
import AcceptInvitePage from "./features/auth/AcceptInvitePage";
import ResetPasswordPage from "./features/auth/ResetPasswordPage";
import UploadPage from "./features/upload/UploadPage";
import DocumentsListPage from "./features/documents/DocumentsListPage";
import DocumentDetailPage from "./features/documents/DocumentDetailPage";
import ExportPage from "./features/export/ExportPage";
import ExtractionSettingsPage from "./features/settings/ExtractionSettingsPage";
import UserManagementPage from "./features/users/UserManagementPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/accept-invite/:token", element: <AcceptInvitePage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/upload", element: <UploadPage /> },
          { path: "/documents", element: <DocumentsListPage /> },
          { path: "/documents/:id", element: <DocumentDetailPage /> },
          { path: "/export", element: <ExportPage /> },
          {
            element: <AdminRoute />,
            children: [
              { path: "/settings", element: <ExtractionSettingsPage /> },
              { path: "/users", element: <UserManagementPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "/", element: <Navigate to="/documents" replace /> },
  { path: "*", element: <Navigate to="/documents" replace /> },
]);
