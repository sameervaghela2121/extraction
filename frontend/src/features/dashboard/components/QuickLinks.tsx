import { Link } from "react-router-dom";
import {
  BarChart3,
  Database,
  ScanBarcode,
  Smartphone,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";

const LINKS: Array<{ to: string; label: string; hint: string; icon: LucideIcon; usersOnly?: boolean }> = [
  { to: "/reports/consumption", label: "Reports", hint: "Consumption & daily rolls", icon: BarChart3 },
  { to: "/masters/rolls", label: "Rolls", hint: "Register & corrections", icon: Database },
  { to: "/masters/lots", label: "Lots", hint: "Challan / invoice lots", icon: Database },
  { to: "/barcodes", label: "Barcodes", hint: "Print label batches", icon: ScanBarcode },
  { to: "/users", label: "Users", hint: "Invite operators", icon: Users, usersOnly: true },
  { to: "/download-app", label: "Download app", hint: "Tablet APK", icon: Smartphone },
];

export default function QuickLinks() {
  const { user } = useAuth();
  const canUsers =
    user?.role === "godown_supervisor" || user?.role === "admin" || user?.role === "super_admin";

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <h2 className="dashboard-panel-title">Quick links</h2>
      </div>
      <div className="dashboard-quick-grid">
        {LINKS.filter((l) => !l.usersOnly || canUsers).map((link) => (
          <Link key={link.to} to={link.to} className="dashboard-quick-link">
            <link.icon size={18} />
            <span>
              <strong>{link.label}</strong>
              <span className="faint">{link.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
