import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Upload,
  FolderOpen,
  ClipboardList,
  ClipboardCheck,
  Receipt,
  Download,
  Settings,
  Users,
  Database,
  ScanBarcode,
  ChevronDown,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Avatar } from "../components/ui";

/** One entry inside a group. No icon of its own — the group's icon stands for the set,
 *  and a column of near-identical glyphs under it reads as noise rather than navigation. */
interface NavChild {
  to: string;
  label: string;
}

interface NavItem {
  /** Absent on a group: it toggles its children open instead of navigating anywhere. */
  to?: string;
  label: string;
  icon: LucideIcon;
  /** Present makes this a group. Role flags are read off the parent only — a group and
   *  its children are one section, so they are shown or hidden together. */
  children?: NavChild[];
  adminOnly?: boolean;
  /** Staff only need the GRN workflow — everything else is hidden for them unless
   *  opted in here. Admins always see the full nav regardless of this flag. */
  staffVisible?: boolean;
  /** The godown supervisor's whole panel is the section flagged here — nothing else.
   *  Admin does NOT see these: the Royal Touche godown data is the supervisor's. */
  supervisorVisible?: boolean;
  /** NavLink prefix-matches by default, so "/grn" would light up on "/grn/new" too. */
  end?: boolean;
}

// ponytail: masters are built and working, just not wanted in the nav yet. Flip to true to
// bring the Master group back — nothing else has to change.
const MASTERS_ENABLED = true;

const NAV: NavItem[] = [
  { to: "/upload", label: "Upload & Scan", icon: Upload },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: "/grn/new", label: "Create GRN", icon: ClipboardList, staffVisible: true },
  { to: "/grn", label: "GRN", icon: ClipboardCheck, end: true, staffVisible: true },
  { to: "/general-vouchers/upload", label: "Upload Voucher", icon: Receipt },
  { to: "/general-vouchers", label: "General Vouchers", icon: Receipt, end: true },
  { to: "/export", label: "Export", icon: Download },
  { to: "/settings", label: "Extraction settings", icon: Settings, adminOnly: true },
  { to: "/users", label: "User management", icon: Users, adminOnly: true },
  // The Royal Touche masters, grouped: four entries that are always maintained together
  // read as one section, not as four peers of Barcode generator.
  {
    label: "Master",
    icon: Database,
    supervisorVisible: true,
    children: [
      { to: "/masters/vendors", label: "Vendors & papers" },
      { to: "/masters/locations", label: "Locations" },
      { to: "/masters/material-types", label: "Material types" },
      { to: "/masters/remarks", label: "Remarks" },
    ],
  },
  { to: "/barcodes", label: "Barcode generator", icon: ScanBarcode, supervisorVisible: true },
];

/** Every leaf a nav item points at. A group contributes its children; anything else is
 *  its own leaf. Used for the mobile bar, which is a flat strip of icons and has no way
 *  to nest — flattening keeps all four masters reachable on a phone. */
function leaves(item: NavItem): Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> {
  if (item.children) return item.children.map((c) => ({ ...c, icon: item.icon }));
  return [{ to: item.to!, label: item.label, icon: item.icon, end: item.end }];
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Which groups the user has CLOSED. Absent means open, so a group starts expanded and
  // only ever collapses because someone collapsed it.
  //
  // Deliberately not keyed off the route: deriving it from "is the current page inside
  // this group" meant navigating to Barcode generator folded the group shut, and it only
  // appeared to work once the user had clicked the header, because that finally wrote an
  // entry here for the route to stop overriding.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const items = NAV.filter((i) => {
    if (!MASTERS_ENABLED && leaves(i).some((l) => l.to.startsWith("/masters"))) return false;
    if (user?.role === "admin") return !i.supervisorVisible;
    if (user?.role === "godown_supervisor") return Boolean(i.supervisorVisible);
    if (i.adminOnly) return false;
    return Boolean(i.staffVisible);
  });

  // Only for highlighting the header — the group's open state no longer depends on it.
  const isInside = (item: NavItem) => Boolean(item.children?.some((c) => pathname.startsWith(c.to)));
  const isOpen = (item: NavItem) => !collapsed[item.label];
  const toggle = (item: NavItem) =>
    setCollapsed((prev) => ({ ...prev, [item.label]: isOpen(item) }));

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
          {items.map((item) =>
            item.children ? (
              <div key={item.label}>
                <button
                  type="button"
                  className={`nav-link nav-group${isInside(item) ? " inside" : ""}`}
                  onClick={() => toggle(item)}
                  aria-expanded={isOpen(item)}
                >
                  <item.icon size={18} />
                  {item.label}
                  <span className="spacer" />
                  <ChevronDown size={15} className={`nav-chev${isOpen(item) ? " open" : ""}`} />
                </button>
                {isOpen(item) && (
                  <div className="nav-sub">
                    {item.children.map((child) => (
                      <NavLink key={child.to} to={child.to} className="nav-sublink">
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <NavLink key={item.to} to={item.to!} end={item.end} className="nav-link">
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ),
          )}
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
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Mobile top bar: sidebar (with the only profile/logout UI) is hidden below 900px,
          so this duplicates just that piece for small screens. */}
      <header className="app-mobilebar">
        <div className="row gap-8">
          <Avatar name={user?.name ?? "?"} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.name}
            </div>
            <div className="faint" style={{ fontSize: 12, textTransform: "capitalize" }}>{user?.role}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out">
          <LogOut size={16} />
        </button>
      </header>

      {/* Main content */}
      <main
        className="app-main"
        style={{ marginLeft: "var(--sidebar-w)", flex: 1, padding: "28px 32px 80px", maxWidth: 1200, minWidth: 0 }}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav. A horizontal icon strip cannot nest, so groups are flattened
          here rather than collapsed — otherwise three of the four masters would have no
          route to them at all on a phone. */}
      <nav className="app-bottomnav">
        {items.flatMap(leaves).map((leaf) => (
          <NavLink key={leaf.to} to={leaf.to} end={leaf.end} className="bottomnav-link">
            <leaf.icon size={18} />
            <span style={{ fontSize: 10 }}>{leaf.label.split(" ")[0]}</span>
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
        /* The group header is a button, not a link — it toggles rather than navigates, so
           it needs the browser's button chrome stripped back to match its siblings. */
        .nav-group {
          width: 100%; background: none; border: 0;
          font: inherit; font-weight: 500; text-align: left; cursor: pointer;
        }
        /* Darkened, not brand-tinted: the active pill belongs to the child you are on,
           and two highlights in one group would compete for it. */
        .nav-group.inside { color: var(--text); }
        .nav-chev { flex: none; transition: transform 150ms ease; }
        .nav-chev.open { transform: rotate(180deg); }
        /* The rail sits under the parent's icon, so the children read as hanging off it. */
        .nav-sub {
          display: flex; flex-direction: column; gap: 2px;
          margin: 2px 0 4px 18px; padding-left: 10px;
          border-left: 1px solid var(--border);
        }
        .nav-sublink {
          padding: 7px 10px; border-radius: 8px;
          color: var(--text-muted); font-size: 13px; text-decoration: none;
        }
        .nav-sublink:hover { background: var(--surface-2); text-decoration: none; }
        .nav-sublink.active { background: var(--brand-soft); color: var(--brand-strong); font-weight: 600; }
        /* display/flex-direction live here, not as inline styles on the <aside>, so the
           max-width:900px override below can actually win — an inline style beats a
           plain class rule regardless of media query, !important or not. */
        .app-sidebar { display: flex; flex-direction: column; }
        .app-bottomnav { display: none; }
        .app-mobilebar { display: none; }
        @media (max-width: 900px) {
          .app-sidebar { display: none; }
          .app-main { margin-left: 0 !important; padding: 20px 16px 84px !important; }
          .app-mobilebar {
            display: flex; align-items: center; justify-content: space-between;
            position: fixed; top: 0; left: 0; right: 0; z-index: 50;
            background: var(--surface); border-bottom: 1px solid var(--border);
            padding: 10px 16px;
          }
          .app-main { padding-top: 74px !important; }
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
