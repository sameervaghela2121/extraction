import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { usersApi } from "../../api/users.api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, Spinner, Avatar, Modal } from "../../components/ui";
import type { ManagedUser, UserRole, UserStatus } from "../../types";

// This panel only ever deals in the two godown roles — staff and admin accounts are
// managed outside it, and super_admin never appears here at all. The backend enforces the
// same boundary (usersService.list filters by role, invite rejects anything else), so this
// is UI convenience on top of a real restriction, not the restriction itself.
const GODOWN_ROLES: ReadonlyArray<readonly [UserRole, string]> = [
  ["godown_supervisor", "Godown supervisor"],
  ["godown_operator", "Godown operator"],
];
const ROLE_LABEL: Partial<Record<UserRole, string>> = Object.fromEntries(GODOWN_ROLES);

type InviteForm = { name: string; email: string; role: UserRole };
const EMPTY_INVITE: InviteForm = { name: "", email: "", role: "godown_operator" };

export default function UserManagementPage() {
  const { user: me } = useAuth();
  const { notify } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<InviteForm>(EMPTY_INVITE);
  const [inviting, setInviting] = useState(false);

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("godown_operator");
  const [editStatus, setEditStatus] = useState<UserStatus>("active");
  const [saving, setSaving] = useState(false);

  // A godown supervisor only ever invites operators, and role/status edits stay
  // admin/super_admin-only — the backend already 403s otherwise, this just keeps the UI
  // from offering a control that would fail.
  const canEdit = me?.role === "admin" || me?.role === "super_admin";
  const inviteRoles = me?.role === "godown_supervisor" ? GODOWN_ROLES.filter(([v]) => v === "godown_operator") : GODOWN_ROLES;

  const load = async () => {
    setLoading(true);
    try {
      // Defensive filter on top of the backend's own — belt and suspenders against this
      // list ever showing a role it shouldn't.
      const rows = await usersApi.list();
      setUsers(rows.filter((u) => u.role === "godown_supervisor" || u.role === "godown_operator"));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, search]);

  const openInvite = () => {
    setInvite({ ...EMPTY_INVITE, role: inviteRoles[0][0] });
    setInviteOpen(true);
  };

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      await usersApi.invite(invite.name, invite.email, invite.role);
      notify(`Invite sent to ${invite.email}`);
      setInviteOpen(false);
      load();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setInviting(false);
    }
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    setEditRole(u.role);
    // "invited" isn't a toggle target — there's nothing useful about manually reverting an
    // active account back to it, so the edit form only offers active/suspended.
    setEditStatus(u.status === "invited" ? "active" : u.status);
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await usersApi.update(editing.id, { role: editRole, status: editStatus });
      setUsers((prev) => prev.map((u) => (u.id === editing.id ? { ...u, ...updated } : u)));
      notify("Saved");
      setEditing(null);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="User management"
        subtitle="Invite and manage godown supervisors and operators."
        actions={
          <button className="btn btn-primary" onClick={openInvite}>
            <Plus size={15} /> Invite user
          </button>
        }
      />

      <div className="row gap-8" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <Spinner />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="hide-narrow">Documents</th>
                  <th>Status</th>
                  {canEdit && <th style={{ width: 90 }}></th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="row gap-8">
                        <Avatar name={u.name} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div className="faint" style={{ fontSize: 12 }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`pill pill-role-${u.role === "godown_supervisor" ? "supervisor" : "operator"}`}
                      >
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="muted hide-narrow">{u.docCount}</td>
                    <td>
                      <span
                        className={`pill ${u.status === "active" ? "pill-verified" : u.status === "invited" ? "pill-pending" : "pill-archived"}`}
                      >
                        {u.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 5 : 4} className="faint" style={{ textAlign: "center", padding: 20 }}>
                      {search ? "Nothing matches that search." : "No godown users yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite user" size="medium">
        <form onSubmit={submitInvite} style={{ display: "grid", gap: 14, padding: 16 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Full name</span>
            <input
              className="input"
              value={invite.name}
              onChange={(e) => setInvite((v) => ({ ...v, name: e.target.value }))}
              required
              autoFocus
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Email</span>
            <input
              className="input"
              type="email"
              value={invite.email}
              onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
              required
            />
          </label>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Role</span>
            <div className="row gap-8" style={{ flexWrap: "wrap" }}>
              {inviteRoles.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn-sm ${invite.role === value ? "btn-primary" : ""}`}
                  onClick={() => setInvite((v) => ({ ...v, role: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setInviteOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={inviting}>
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : ""} size="medium">
        <form onSubmit={submitEdit} style={{ display: "grid", gap: 14, padding: 16 }}>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Role</span>
            <div className="row gap-8" style={{ flexWrap: "wrap" }}>
              {GODOWN_ROLES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn-sm ${editRole === value ? "btn-primary" : ""}`}
                  onClick={() => setEditRole(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Status</span>
            <div className="row gap-8">
              <button
                type="button"
                className={`btn btn-sm ${editStatus === "active" ? "btn-primary" : ""}`}
                onClick={() => setEditStatus("active")}
              >
                Active
              </button>
              <button
                type="button"
                className={`btn btn-sm ${editStatus === "suspended" ? "btn-primary" : ""}`}
                onClick={() => setEditStatus("suspended")}
              >
                Suspended
              </button>
            </div>
          </div>
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
