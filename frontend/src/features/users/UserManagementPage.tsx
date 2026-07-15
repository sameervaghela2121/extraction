import { useEffect, useState, type FormEvent } from "react";
import { usersApi } from "../../api/users.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader, Spinner, Avatar } from "../../components/ui";
import type { ManagedUser, UserRole, UserStatus } from "../../types";

export default function UserManagementPage() {
  const { notify } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("staff");

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await usersApi.list());
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await usersApi.invite(name, email, role);
      notify(`Invite sent to ${email}`);
      setName("");
      setEmail("");
      setRole("staff");
      setInviting(false);
      load();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  const update = async (id: string, updates: { role?: UserRole; status?: UserStatus }) => {
    try {
      const updated = await usersApi.update(id, updates);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updated } : u)));
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="User management"
        subtitle="Invite teammates and manage their access."
        actions={
          <button className="btn btn-primary" onClick={() => setInviting((v) => !v)}>
            {inviting ? "Cancel" : "Invite user"}
          </button>
        }
      />

      {inviting && (
        <form onSubmit={invite} className="card row gap-8" style={{ padding: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" style={{ flex: 1, minWidth: 160 }} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="row gap-8">
            <button type="button" className={`btn btn-sm ${role === "staff" ? "btn-primary" : ""}`} onClick={() => setRole("staff")}>Staff</button>
            <button type="button" className={`btn btn-sm ${role === "admin" ? "btn-primary" : ""}`} onClick={() => setRole("admin")}>Admin</button>
          </div>
          <button className="btn btn-primary" type="submit">Send invite</button>
        </form>
      )}

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
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const editing = editingId === u.id;
                return (
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
                      {editing ? (
                        <div className="row gap-8">
                          <button className={`btn btn-sm ${u.role === "staff" ? "btn-primary" : ""}`} onClick={() => update(u.id, { role: "staff" })}>Staff</button>
                          <button className={`btn btn-sm ${u.role === "admin" ? "btn-primary" : ""}`} onClick={() => update(u.id, { role: "admin" })}>Admin</button>
                        </div>
                      ) : (
                        <span style={{ textTransform: "capitalize" }}>{u.role}</span>
                      )}
                    </td>
                    <td className="muted hide-narrow">{u.docCount}</td>
                    <td>
                      {editing ? (
                        <div className="row gap-8">
                          <button className={`btn btn-sm ${u.status === "active" ? "btn-primary" : ""}`} onClick={() => update(u.id, { status: "active" })}>Active</button>
                          <button className={`btn btn-sm ${u.status === "suspended" ? "btn-primary" : ""}`} onClick={() => update(u.id, { status: "suspended" })}>Suspended</button>
                        </div>
                      ) : (
                        <span className={`pill ${u.status === "active" ? "pill-verified" : u.status === "invited" ? "pill-pending" : "pill-archived"}`}>
                          {u.status}
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(editing ? null : u.id)}>
                        {editing ? "Done" : "Edit"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
