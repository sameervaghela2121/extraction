import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Avatar } from "../components/ui";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/upload", label: "Upload & Scan", icon: "⬆" },
  { to: "/documents", label: "Documents", icon: "🗂" },
  { to: "/export", label: "Export", icon: "⇩" },
  { to: "/settings", label: "Extraction settings", icon: "⚙", adminOnly: true },
  { to: "/users", label: "User management", icon: "👥", adminOnly: true },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((i) => !i.adminOnly || user?.role === "admin");

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div style={{ minHeight: "100%", display: "flex" }}>
      {/* Sidebar (desktop) */}
      <aside
        className="app-sidebar"
        style={{
          width: "var(--sidebar-w)",
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
          padding: "18px 14px",
          position: "fixed",
          top: 0,
          bottom: 0,
        }}
      >
        <div className="row gap-8" style={{ padding: "4px 8px 18px" }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--brand)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
            }}
          >
            D
          </span>
          <strong style={{ fontSize: 16 }}>DocFlow</strong>
        </div>

        <nav className="stack" style={{ gap: 2 }}>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-link">
              <span style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="spacer" />

        <div className="row gap-8" style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
          <Avatar name={user?.name ?? "?"} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.name}
            </div>
            <div className="faint" style={{ fontSize: 12, textTransform: "capitalize" }}>{user?.role}</div>
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out">
            ⏻
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className="app-main"
        style={{ marginLeft: "var(--sidebar-w)", flex: 1, padding: "28px 32px 80px", maxWidth: 1200, minWidth: 0 }}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="app-bottomnav">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className="bottomnav-link">
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span style={{ fontSize: 10 }}>{item.label.split(" ")[0]}</span>
          </NavLink>
        ))}
      </nav>

      <style>{`
        .nav-link {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: 8px;
          color: var(--text-muted); font-weight: 500; text-decoration: none;
        }
        .nav-link:hover { background: var(--surface-2); text-decoration: none; }
        .nav-link.active { background: var(--brand-soft); color: var(--brand-strong); }
        /* display/flex-direction live here, not as inline styles on the <aside>, so the
           max-width:900px override below can actually win — an inline style beats a
           plain class rule regardless of media query, !important or not. */
        .app-sidebar { display: flex; flex-direction: column; }
        .app-bottomnav { display: none; }
        @media (max-width: 900px) {
          .app-sidebar { display: none; }
          .app-main { margin-left: 0 !important; padding: 20px 16px 84px !important; }
          .app-bottomnav {
            display: flex; position: fixed; bottom: 0; left: 0; right: 0;
            background: var(--surface); border-top: 1px solid var(--border);
            padding: 6px 4px; z-index: 50;
          }
          .bottomnav-link {
            flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
            padding: 6px 2px; color: var(--text-muted); text-decoration: none; border-radius: 8px;
          }
          .bottomnav-link.active { color: var(--brand-strong); }
        }
      `}</style>
    </div>
  );
}
