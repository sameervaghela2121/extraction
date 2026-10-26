import { useState, type FormEvent } from "react";
import { AxiosError } from "axios";
import { Eye, EyeOff, Plus } from "lucide-react";
import { usersApi } from "../../api/users.api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, Spinner, Avatar, Modal } from "../../components/ui";
import type { ManagedUser, UserRole, UserStatus } from "../../types";
import Pager from "../masters/Pager";
import { useServerPage } from "../masters/useServerPage";

// This panel only ever deals in the two godown roles — staff and admin accounts are
// managed outside it, and super_admin never appears here at all. The backend enforces the
// same boundary (usersService.list filters by role, create rejects anything else), so this
// is UI convenience on top of a real restriction, not the restriction itself.
const GODOWN_ROLES: ReadonlyArray<readonly [UserRole, string]> = [
  ["godown_supervisor", "Godown supervisor"],
  ["godown_operator", "Godown operator"],
];
const ROLE_LABEL: Partial<Record<UserRole, string>> = Object.fromEntries(GODOWN_ROLES);

type AddForm = { name: string; email: string; role: UserRole; password: string; confirm: string };
const EMPTY_ADD: AddForm = { name: "", email: "", role: "godown_operator", password: "", confirm: "" };
type AddErrors = Partial<Record<keyof AddForm, string>>;

const MIN_PASSWORD = 8;

/** The two password checks both forms share: long enough, and typed the same twice. */
function passwordErrors(password: string, confirm: string): { password?: string; confirm?: string } {
  if (password.length < MIN_PASSWORD) return { password: `Use at least ${MIN_PASSWORD} characters.` };
  if (confirm !== password) return { confirm: "The two passwords don't match." };
  return {};
}

/** A password box with a show/hide eye, so a long password can be checked before saving. */
function PasswordInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        style={{ paddingRight: 38 }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setShown((v) => !v)}
        title={shown ? "Hide password" : "Show password"}
        aria-label={shown ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", padding: "4px 8px" }}
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export default function UserManagementPage() {
  const { user: me } = useAuth();
  const { notify } = useToast();
  // Searched and paged by the server, oldest account first — the order the list always had.
  // The godown-only boundary is enforced there too (usersService.search), not just here.
  const { rows: users, setRows: setUsers, total, page, setPage, search, setSearch, query, loading, fetching, reload } =
    useServerPage<ManagedUser>((q) => usersApi.search(q), { key: "createdAt", dir: "asc" });

  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState<AddForm>(EMPTY_ADD);
  const [addErrors, setAddErrors] = useState<AddErrors>({});
  const [adding, setAdding] = useState(false);

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("godown_operator");
  const [editStatus, setEditStatus] = useState<UserStatus>("active");
  const [saving, setSaving] = useState(false);

  const [pwFor, setPwFor] = useState<ManagedUser | null>(null);
  const [pw, setPw] = useState({ password: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<{ password?: string; confirm?: string }>({});
  const [pwSaving, setPwSaving] = useState(false);

  // Anyone who can open this page may add a supervisor or an operator. Admins and super
  // admins edit and set passwords for every godown account; a supervisor only for operators.
  // The backend enforces all of it — this just hides controls that would fail.
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";
  // Admins manage every godown account; a supervisor manages operators (edit and password),
  // not other supervisors.
  const canManageUser = (u: ManagedUser) => isAdmin || (me?.role === "godown_supervisor" && u.role === "godown_operator");
  const canEdit = canManageUser;
  const canSetPassword = canManageUser;
  const showActions = isAdmin || me?.role === "godown_supervisor";

  // Defensive filter on top of the backend's own — belt and suspenders against this list
  // ever showing a role it shouldn't.
  const visible = users.filter((u) => u.role === "godown_supervisor" || u.role === "godown_operator");

  const openAdd = () => {
    setAdd(EMPTY_ADD);
    setAddErrors({});
    setAddOpen(true);
  };

  const setAddField = <K extends keyof AddForm>(field: K, value: AddForm[K]) => {
    setAdd((v) => ({ ...v, [field]: value }));
    setAddErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    const found: AddErrors = {};
    if (!add.name.trim()) found.name = "Enter the person's name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(add.email.trim())) found.email = "Enter a valid email.";
    Object.assign(found, passwordErrors(add.password, add.confirm));
    setAddErrors(found);
    if (Object.keys(found).length) return;

    setAdding(true);
    try {
      await usersApi.create({ name: add.name.trim(), email: add.email.trim(), role: add.role, password: add.password });
      notify(`${add.name.trim()} can log in now`);
      setAddOpen(false);
      reload();
    } catch (err) {
      // A taken email belongs under the email field; anything else isn't about one field.
      if (err instanceof AxiosError && err.response?.status === 409) setAddErrors({ email: apiErrorMessage(err) });
      else notify(apiErrorMessage(err), "error");
    } finally {
      setAdding(false);
    }
  };

  const openSetPassword = (u: ManagedUser) => {
    setPwFor(u);
    setPw({ password: "", confirm: "" });
    setPwErrors({});
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!pwFor) return;
    const found = passwordErrors(pw.password, pw.confirm);
    setPwErrors(found);
    if (Object.keys(found).length) return;

    setPwSaving(true);
    try {
      const res = await usersApi.setPassword(pwFor.id, pw.password);
      // An account still waiting on its invite becomes active once it has a password.
      setUsers((prev) => prev.map((u) => (u.id === pwFor.id ? { ...u, status: res.status } : u)));
      notify(`Password updated for ${pwFor.name}`);
      setPwFor(null);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setPwSaving(false);
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
        subtitle="Add and manage godown supervisors and operators."
        actions={
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Add user
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
                  <th>Status</th>
                  {showActions && <th style={{ width: 200 }}></th>}
                </tr>
              </thead>
              <tbody style={fetching ? { opacity: 0.6 } : undefined}>
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
                    <td>
                      <span
                        className={`pill ${u.status === "active" ? "pill-verified" : u.status === "invited" ? "pill-pending" : "pill-archived"}`}
                      >
                        {u.status}
                      </span>
                    </td>
                    {showActions && (
                      <td>
                        <div className="row gap-8">
                          {canEdit(u) && (
                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>
                              Edit
                            </button>
                          )}
                          {canSetPassword(u) && (
                            <button className="btn btn-ghost btn-sm" onClick={() => openSetPassword(u)}>
                              Set password
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={showActions ? 4 : 3} className="faint" style={{ textAlign: "center", padding: 20 }}>
                      {query ? "Nothing matches that search." : "No godown users yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={page} total={total} onChange={setPage} label="users" />
          </div>
        )}
      </div>

      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add user" size="medium">
        {/* noValidate: each check shows its message under the field instead of the browser popup. */}
        <form onSubmit={submitAdd} noValidate style={{ display: "grid", gap: 14, padding: 16 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Full name *</span>
            <input
              className="input"
              value={add.name}
              onChange={(e) => setAddField("name", e.target.value)}
              aria-invalid={Boolean(addErrors.name) || undefined}
              autoFocus
            />
            {addErrors.name && <span className="field-error">{addErrors.name}</span>}
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Email *</span>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={add.email}
              onChange={(e) => setAddField("email", e.target.value)}
              aria-invalid={Boolean(addErrors.email) || undefined}
            />
            {addErrors.email && <span className="field-error">{addErrors.email}</span>}
          </label>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Role</span>
            <div className="row gap-8" style={{ flexWrap: "wrap" }}>
              {GODOWN_ROLES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn-sm ${add.role === value ? "btn-primary" : ""}`}
                  onClick={() => setAddField("role", value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))", alignItems: "start" }}>
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Password *</span>
              <PasswordInput
                value={add.password}
                onChange={(v) => setAddField("password", v)}
                invalid={Boolean(addErrors.password)}
              />
              {addErrors.password && <span className="field-error">{addErrors.password}</span>}
            </div>
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Confirm password *</span>
              <PasswordInput
                value={add.confirm}
                onChange={(v) => setAddField("confirm", v)}
                invalid={Boolean(addErrors.confirm)}
              />
              {addErrors.confirm && <span className="field-error">{addErrors.confirm}</span>}
            </div>
          </div>
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            The account is active straight away — share the password with them. No email is sent.
          </p>
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={adding}>
              {adding ? "Adding…" : "Add user"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={pwFor !== null}
        onClose={() => setPwFor(null)}
        title={pwFor ? `Set password for ${pwFor.name}` : ""}
        size="medium"
      >
        <form onSubmit={submitPassword} noValidate style={{ display: "grid", gap: 14, padding: 16 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))", alignItems: "start" }}>
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">New password *</span>
              <PasswordInput
                value={pw.password}
                onChange={(v) => {
                  setPw((p) => ({ ...p, password: v }));
                  setPwErrors((e) => ({ ...e, password: undefined }));
                }}
                invalid={Boolean(pwErrors.password)}
              />
              {pwErrors.password && <span className="field-error">{pwErrors.password}</span>}
            </div>
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Confirm password *</span>
              <PasswordInput
                value={pw.confirm}
                onChange={(v) => {
                  setPw((p) => ({ ...p, confirm: v }));
                  setPwErrors((e) => ({ ...e, confirm: undefined }));
                }}
                invalid={Boolean(pwErrors.confirm)}
              />
              {pwErrors.confirm && <span className="field-error">{pwErrors.confirm}</span>}
            </div>
          </div>
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            Replaces their current password — the old one isn&apos;t needed.
          </p>
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setPwFor(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pwSaving}>
              {pwSaving ? "Saving…" : "Set password"}
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
