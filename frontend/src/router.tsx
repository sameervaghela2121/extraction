import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import { ProtectedRoute, AdminRoute, RoleRoute, RoleHome } from "./components/guards";
import LoginPage from "./features/auth/LoginPage";
import AcceptInvitePage from "./features/auth/AcceptInvitePage";
import ResetPasswordPage from "./features/auth/ResetPasswordPage";
import UploadPage from "./features/upload/UploadPage";
import DocumentsListPage from "./features/documents/DocumentsListPage";
import DocumentDetailPage from "./features/documents/DocumentDetailPage";
import ExportPage from "./features/export/ExportPage";
import GrnPage from "./features/grn/GrnPage";
import GrnListPage from "./features/grn/GrnListPage";
import GrnDetailPage from "./features/grn/GrnDetailPage";
import GeneralVoucherUploadPage from "./features/generalVouchers/GeneralVoucherUploadPage";
import GeneralVouchersListPage from "./features/generalVouchers/GeneralVouchersListPage";
import GeneralVoucherDetailPage from "./features/generalVouchers/GeneralVoucherDetailPage";
import ExtractionSettingsPage from "./features/settings/ExtractionSettingsPage";
import UserManagementPage from "./features/users/UserManagementPage";
import MasterDataPage from "./features/masters/MasterDataPage";
import BarcodeGeneratorPage from "./features/barcodes/BarcodeGeneratorPage";

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
          // Staff's whole world — reachable by every role except the godown supervisor,
          // whose panel is the masters section and nothing else.
          {
            element: <RoleRoute deny={["godown_supervisor"]} />,
            children: [
              { path: "/grn", element: <GrnListPage /> },
              { path: "/grn/new", element: <GrnPage /> },
              { path: "/grn/:id", element: <GrnDetailPage /> },
            ],
          },
          {
            element: <RoleRoute allow={["godown_supervisor"]} />,
            children: [
              { path: "/masters", element: <Navigate to="/masters/vendors" replace /> },
              { path: "/masters/:section", element: <MasterDataPage /> },
              { path: "/barcodes", element: <BarcodeGeneratorPage /> },
            ],
          },
          {
            element: <RoleRoute deny={["staff", "godown_supervisor"]} />,
            children: [
              { path: "/upload", element: <UploadPage /> },
              { path: "/documents", element: <DocumentsListPage /> },
              { path: "/documents/:id", element: <DocumentDetailPage /> },
              { path: "/general-vouchers/upload", element: <GeneralVoucherUploadPage /> },
              { path: "/general-vouchers", element: <GeneralVouchersListPage /> },
              { path: "/general-vouchers/:id", element: <GeneralVoucherDetailPage /> },
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
    ],
  },
  { path: "/", element: <RoleHome /> },
  { path: "*", element: <RoleHome /> },
]);
