import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { vendorsApi } from "../../api/masters.api";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Pager, { pageOf } from "./Pager";
import type { Vendor, VendorPaper } from "../../types";

/**
 * The paper-codes sheet, as its own screen.
 *
 * Papers are still embedded in their supplier server-side — there is no papers collection
 * and no papers endpoint, and nothing about the backend changed for this screen. So a row
 * here is "paper N of vendor V", every edit is a PATCH of that vendor's whole `papers`
 * array, and the list is built by reading every vendor once and flattening.
 *
 * That embedding is also why a row is identified by its vendor plus its position rather
 * than by an id: the rows have none (`{ _id: false }` on the schema), and an RT code is not
 * unique either — 42 of them are supplied by more than one vendor.
 */

/** What makes two paper rows the same paper, mirroring paperKey() in vendors.service.ts.
 *  A Delta-range paper has no RT code, so it is keyed by its delta code instead. */
function paperKey(paper: VendorPaper): string {
  return (paper.royal_touche_code || `delta:${paper.delta_code ?? ""}`).toUpperCase();
}

/** One flattened row: the paper, the supplier it belongs to, and where it sits in that
 *  supplier's array — which is what a save has to address. */
interface Row {
  vendor: Vendor;
  index: number;
  paper: VendorPaper;
}

interface FormState {
  vendorId: string;
  royal_touche_code: string;
  delta_code: string;
  supplier_code_number: string;
  found_in: string;
  is_common: boolean;
}

const EMPTY: FormState = {
  vendorId: "",
  royal_touche_code: "",
  delta_code: "",
  supplier_code_number: "",
  found_in: "",
  is_common: false,
};

function toForm(row: Row): FormState {
  return {
    vendorId: row.vendor.id,
    royal_touche_code: row.paper.royal_touche_code ?? "",
    delta_code: row.paper.delta_code ?? "",
    supplier_code_number: row.paper.supplier_code_number ?? "",
    found_in: row.paper.found_in ?? "",
    is_common: Boolean(row.paper.is_common),
  };
}

/** Blank fields are dropped rather than stored as "" — the backend treats an absent code
 *  and an empty one differently, and a sparse row is what the seed writes too. */
function toPaper(form: FormState): VendorPaper {
  return {
    royal_touche_code: form.royal_touche_code.trim().toUpperCase() || undefined,
    delta_code: form.delta_code.trim().toUpperCase() || undefined,
    supplier_code_number: form.supplier_code_number.trim() || undefined,
    found_in: form.found_in.trim() || undefined,
    is_common: form.is_common || undefined,
  };
}

function matches(row: Row, q: string): boolean {
  return [
    row.paper.royal_touche_code,
    row.paper.delta_code,
    row.paper.supplier_code_number,
    row.paper.found_in,
    row.vendor.vendor_code,
    row.vendor.name,
  ].some((value) => (value ?? "").toLowerCase().includes(q));
}

/** Searchable vendor dropdown. 74 suppliers arrive in one unpaginated call, so this
 *  filters what is already in memory rather than querying per keystroke. */
function VendorPicker({
  vendors,
  value,
  onChange,
}: {
  vendors: Vendor[];
  value: string;
  onChange: (vendorId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = vendors.find((v) => v.id === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => `${v.vendor_code ?? ""} ${v.name}`.toLowerCase().includes(q));
  }, [vendors, query]);

  const labelOf = (v: Vendor) => (v.vendor_code ? `${v.vendor_code} · ${v.name}` : v.name);

  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        placeholder="Search a vendor by name or code"
        // Closed, the box shows the chosen supplier; open, it shows what is being typed.
        // Otherwise the field reads as an empty search box next to a made choice.
        value={open ? query : selected ? labelOf(selected) : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}
        >
          {shown.map((v) => (
            <button
              key={v.id}
              type="button"
              className="vendor-option"
              // onMouseDown, not onClick: the input's blur fires first on a click and would
              // unmount this list before the click ever landed on it.
              onMouseDown={() => {
                onChange(v.id);
                setOpen(false);
              }}
            >
              {labelOf(v)}
            </button>
          ))}
          {shown.length === 0 && (
            <div className="faint" style={{ padding: 10, fontSize: 13 }}>
              No vendor matches that.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RawMaterialPage() {
  const { notify } = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // null = closed, "new" = adding, otherwise the row being edited.
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setVendors(await vendorsApi.list());
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

  const rows = useMemo(
    () =>
      vendors.flatMap((vendor) =>
        (vendor.papers ?? []).map((paper, index) => ({ vendor, index, paper })),
      ),
    [vendors],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((row) => matches(row, q)) : rows;
  }, [rows, search]);

  // A filter that shrinks the list under the current page would otherwise leave an empty
  // table with no obvious way back.
  useEffect(() => {
    setPage(1);
  }, [search]);

  const pageRows = pageOf(visible, page);

  const openCreate = () => {
    setForm(EMPTY);
    setEditing("new");
  };

  const openEdit = (row: Row) => {
    setForm(toForm(row));
    setEditing(row);
  };

  const setValue = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const paper = toPaper(form);

    if (!form.vendorId) return notify("Pick the vendor this raw material comes from.", "error");
    // The same rule the backend's basePaperSchema enforces, checked here so the message
    // names the field instead of arriving as a validation error after a round trip.
    if (!paper.royal_touche_code && !paper.delta_code) {
      return notify("Enter a Royal Touche code or a Delta code.", "error");
    }

    const target = vendors.find((v) => v.id === form.vendorId);
    if (!target) return notify("That vendor no longer exists — reload and try again.", "error");

    const from = editing !== "new" && editing ? editing : null;
    const moving = Boolean(from && from.vendor.id !== target.id);

    // Codes repeat across suppliers — 42 already do — but two rows with the same code under
    // ONE supplier would collide, because the backend merges a vendor's papers by code.
    const key = paperKey(paper);
    const clashes = (target.papers ?? []).some(
      (p, i) => paperKey(p) === key && !(from && !moving && i === from.index),
    );
    if (clashes) {
      return notify(`${target.name} already has a raw material with this code.`, "error");
    }

    setSaving(true);
    try {
      const targetPapers =
        from && !moving
          ? (target.papers ?? []).map((p, i) => (i === from.index ? paper : p))
          : [...(target.papers ?? []), paper];

      // Added to the new supplier before being removed from the old one. If the second call
      // fails the row is duplicated — visible, and deletable — rather than lost from both.
      await vendorsApi.update(target.id, { papers: targetPapers });
      if (from && moving) {
        await vendorsApi.update(from.vendor.id, {
          papers: (from.vendor.papers ?? []).filter((_, i) => i !== from.index),
        });
      }

      await load();
      setEditing(null);
      notify(from ? "Saved" : "Raw material added");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Row) => {
    try {
      await vendorsApi.update(row.vendor.id, {
        papers: (row.vendor.papers ?? []).filter((_, i) => i !== row.index),
      });
      await load();
      notify("Raw material removed");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Raw material"
        subtitle="The Royal Touche paper codes, and the supplier each one comes from."
      />

      <div className="row gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Search by code, supplier code or vendor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={15} /> Add raw material
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
                  <th>RT code</th>
                  <th>Delta code</th>
                  <th>Supplier code / name</th>
                  <th>Vendor code</th>
                  <th>Vendor name</th>
                  <th>Found in</th>
                  <th style={{ width: 70 }}>Common</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={`${row.vendor.id}:${row.index}`}>
                    <td>{row.paper.royal_touche_code || "—"}</td>
                    <td>{row.paper.delta_code || "—"}</td>
                    <td>{row.paper.supplier_code_number || "—"}</td>
                    <td>{row.vendor.vendor_code || "—"}</td>
                    <td>{row.vendor.name}</td>
                    <td>{row.paper.found_in || "—"}</td>
                    <td style={{ textAlign: "center" }}>{row.paper.is_common ? "✓" : "—"}</td>
                    <td>
                      <div className="row gap-8">
                        <button className="btn btn-sm" onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="Delete raw material"
                          onClick={() => remove(row)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="faint" style={{ textAlign: "center", padding: 20 }}>
                      {search ? "Nothing matches that search." : "Nothing here yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={page} total={visible.length} onChange={setPage} label="raw materials" />
          </div>
        )}
      </div>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add raw material" : "Edit raw material"}
        size="medium"
      >
        <form onSubmit={submit} style={{ display: "grid", gap: 12, padding: 16 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Vendor *</span>
            <VendorPicker
              vendors={vendors}
              value={form.vendorId}
              onChange={(id) => setValue("vendorId", id)}
            />
          </label>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">RT code</span>
              <input
                className="input"
                value={form.royal_touche_code}
                onChange={(e) => setValue("royal_touche_code", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Delta code</span>
              <input
                className="input"
                value={form.delta_code}
                onChange={(e) => setValue("delta_code", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Supplier code / name</span>
              <input
                className="input"
                value={form.supplier_code_number}
                onChange={(e) => setValue("supplier_code_number", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Found in</span>
              <input
                className="input"
                value={form.found_in}
                onChange={(e) => setValue("found_in", e.target.value)}
              />
            </label>
          </div>

          <label className="row gap-8" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.is_common}
              onChange={(e) => setValue("is_common", e.target.checked)}
            />
            <span>Common — the same paper serves RT and Delta under different design numbers</span>
          </label>

          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            A raw material needs a Royal Touche code or a Delta code. Only rows with an RT
            code can be picked for a roll.
          </p>

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

      <style>{`
        .vendor-option {
          display: block; width: 100%; text-align: left;
          padding: 8px 10px; border: 0; background: none;
          font: inherit; font-size: 13px; color: var(--text); cursor: pointer;
        }
        .vendor-option:hover { background: var(--surface-2); }
      `}</style>
    </div>
  );
}
