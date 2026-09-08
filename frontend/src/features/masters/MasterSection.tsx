import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Pager, { pageOf } from "./Pager";
import type { MasterRow, MasterSpec } from "./specs";

// Papers used to ride along here as a second editor inside the vendor form. They have their
// own screen now (RawMaterialPage), so this is back to being one flat row of fields.
type FormState = { values: Record<string, string> };

const EMPTY: FormState = { values: {} };

function toForm(row: MasterRow): FormState {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && v !== undefined && typeof v !== "object") values[k] = String(v);
  }
  return { values };
}

export default function MasterSection({ spec }: { spec: MasterSpec }) {
  const { notify } = useToast();
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // null = closed, "new" = create, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await spec.api.list());
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key]);

  // Filtered here rather than server-side: these lists are read whole (no pagination on
  // any of the three endpoints), so a round-trip per keystroke would buy nothing.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      spec.fields.some((f) => String(row[f.name] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search, spec.fields]);

  // A filter that shrinks the list under the current page would otherwise leave an empty
  // table with no obvious way back.
  useEffect(() => {
    setPage(1);
  }, [search, spec.key]);

  const pageRows = pageOf(visible, page);

  const openCreate = () => {
    setForm(EMPTY);
    setEditing("new");
  };

  const openEdit = (row: MasterRow) => {
    setForm(toForm(row));
    setEditing(row.id);
  };

  const setValue = (name: string, value: string) =>
    setForm((prev) => ({ ...prev, values: { ...prev.values, [name]: value } }));

  const buildBody = (): Partial<MasterRow> => {
    const body: Record<string, unknown> = {};
    for (const field of spec.fields) {
      const raw = form.values[field.name]?.trim() ?? "";
      // Omit blanks so a PATCH doesn't overwrite a stored value with "".
      if (!raw) continue;
      body[field.name] = field.type === "number" ? Number(raw) : raw;
    }
    // `papers` is deliberately never sent from here. applyUpdates skips undefined fields
    // server-side, so a vendor PATCH from this form leaves its paper rows untouched rather
    // than replacing them with an empty array.
    return body;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = buildBody();
      const saved =
        editing === "new" ? await spec.api.create(body) : await spec.api.update(editing!, body);
      setRows((prev) =>
        editing === "new" ? [...prev, saved] : prev.map((r) => (r.id === saved.id ? saved : r)),
      );
      setEditing(null);
      notify(editing === "new" ? `${spec.noun} added` : "Saved");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  // DELETE is a soft delete server-side (status → inactive), so this pair is really one
  // toggle — no destructive confirm needed, and reactivating is just a PATCH back.
  const toggleStatus = async (row: MasterRow) => {
    try {
      const saved =
        row.status === "active"
          ? ((await spec.api.remove(row.id)) as MasterRow)
          : await spec.api.update(row.id, { status: "active" });
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: saved.status ?? "inactive" } : r)),
      );
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  const columns = spec.fields.filter((f) => f.inList);

  return (
    <div>
      <PageHeader title={spec.label} subtitle={spec.subtitle} />

      <div className="row gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={`Search ${spec.label.toLowerCase()}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={15} /> Add {spec.noun}
        </button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <Spinner />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.name}>{c.label}</th>
                  ))}
                  <th>Status</th>
                  <th style={{ width: 150 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c.name}>{String(row[c.name] ?? "—")}</td>
                    ))}
                    <td style={{ textTransform: "capitalize" }}>{row.status}</td>
                    <td>
                      <div className="row gap-8">
                        <button className="btn btn-sm" onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(row)}>
                          {row.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 2}
                      className="faint"
                      style={{ textAlign: "center", padding: 20 }}
                    >
                      {search ? "Nothing matches that search." : "Nothing here yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={page} total={visible.length} onChange={setPage} label={spec.plural} />
          </div>
        )}
      </div>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? `Add ${spec.noun}` : `Edit ${spec.noun}`}
        size="medium"
      >
        <form onSubmit={submit} style={{ display: "grid", gap: 12, padding: 16 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            {spec.fields.map((f) => (
              <label key={f.name} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="faint">
                  {f.label}
                  {f.required && " *"}
                </span>
                <input
                  className="input"
                  type={f.type === "number" ? "number" : "text"}
                  value={form.values[f.name] ?? ""}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  required={f.required}
                />
              </label>
            ))}
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
