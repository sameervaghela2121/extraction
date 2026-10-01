import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { vendorsApi, type PaperRow } from "../../api/masters.api";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Pager from "./Pager";
import { nextSort, SortHeader } from "./sorting";
import { useServerPage } from "./useServerPage";
import type { VendorPaper } from "../../types";

/**
 * The paper-codes sheet, as its own screen.
 *
 * Papers are embedded in their supplier server-side — there is no papers collection. So a
 * row here is "paper N of vendor V", and every edit is a PATCH of that vendor's whole
 * `papers` array. The list itself is searched and paged by the server
 * (POST /vendors/papers/search), one page at a time.
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

/** One row: the paper, the supplier it belongs to, and where it sits in that supplier's
 *  array — which is what a save has to address. */
type Row = PaperRow;

/**
 * `found_in` and `is_common` are carried but never rendered.
 *
 * They were taken off the form, not out of the data — 442 rows have a `found_in` value. A
 * save writes the whole paper object back, so dropping them here would silently blank both
 * fields on every row anyone edited. They round-trip instead: read on open, written back
 * untouched on save, and simply absent on a row created from this screen.
 */
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

/** A row that moved or changed since the page loaded. Its own class so its message reaches
 *  the user — apiErrorMessage only passes API errors through. */
class StaleRowError extends Error {}

const errorText = (err: unknown) => (err instanceof StaleRowError ? err.message : apiErrorMessage(err));

/** A vendor as the picker shows and returns it. */
type VendorOption = PaperRow["vendor"];

const vendorLabel = (v: VendorOption) => (v.vendor_code ? `${v.vendor_code} · ${v.name}` : v.name);

/** Vendors per request. The dropdown asks for the next batch as it scrolls. */
const VENDOR_PAGE = 25;
/** How close to the bottom of the list (px) counts as "reached the end". */
const NEAR_BOTTOM_PX = 40;

/**
 * Searchable vendor dropdown, searched by the server (POST /vendors/search) — the same
 * search as the Vendors page, without each vendor's papers. Every vendor is reachable: the
 * list loads 25 at a time and fetches the next 25 as it's scrolled near the bottom.
 *
 * Typing starts a new search (debounced) from page 1. Each search has an id; an answer for
 * an older search is dropped, so a slow response can't mix into a newer list, and a page is
 * never requested twice while it's already on its way.
 */
function VendorPicker({
  selected,
  invalid,
  onChange,
}: {
  selected: VendorOption | null;
  invalid?: boolean;
  onChange: (vendor: VendorOption) => void;
}) {
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<VendorOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  /** The current search. Bumped on every new one; older answers are ignored. */
  const searchId = useRef(0);
  /** What the current search is for — null until its debounce fires, so a scroll in the
   *  meantime can't load a page of the previous search under the new one's id. */
  const activeQuery = useRef<string | null>(null);
  const nextPage = useRef(1);
  /** The search whose page is in flight, so the same page isn't requested twice. */
  const inFlight = useRef<number | null>(null);

  const loadPage = useCallback(
    async (id: number, q: string) => {
      if (inFlight.current === id) return;
      inFlight.current = id;
      setLoading(true);
      const page = nextPage.current;
      try {
        const res = await vendorsApi.search({ page, pageSize: VENDOR_PAGE, q: q || undefined, sort: "name" });
        if (id !== searchId.current) return;
        const batch = res.items.map((v) => ({ id: v.id, name: v.name, vendor_code: v.vendor_code }));
        nextPage.current = page + 1;
        setOptions((prev) => (page === 1 ? batch : [...prev, ...batch]));
        setTotal(res.total);
      } catch (err) {
        if (id === searchId.current) notify(apiErrorMessage(err), "error");
      } finally {
        if (inFlight.current === id) inFlight.current = null;
        if (id === searchId.current) setLoading(false);
      }
    },
    [notify],
  );

  // A new search: from page 1, once typing pauses.
  useEffect(() => {
    if (!open) return;
    const id = ++searchId.current;
    activeQuery.current = null;
    nextPage.current = 1;
    setOptions([]);
    setTotal(0);
    setLoading(true);
    const timer = setTimeout(() => {
      activeQuery.current = query.trim();
      loadPage(id, activeQuery.current);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, loadPage]);

  /** Fetch the next batch if the list is scrolled near its end — or is too short to scroll
   *  at all, which would otherwise leave the rest unreachable. */
  const loadMoreIfNeeded = useCallback(() => {
    const el = listRef.current;
    if (!el || activeQuery.current === null || options.length >= total) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX) {
      loadPage(searchId.current, activeQuery.current);
    }
  }, [options.length, total, loadPage]);

  // After each batch lands: if it didn't fill the list, keep going.
  useEffect(() => {
    if (open) loadMoreIfNeeded();
  }, [open, options, loadMoreIfNeeded]);

  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        placeholder="Search a vendor by name or code"
        aria-invalid={invalid || undefined}
        // Closed, the box shows the chosen supplier; open, it shows what is being typed.
        // Otherwise the field reads as an empty search box next to a made choice.
        value={open ? query : selected ? vendorLabel(selected) : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div
          ref={listRef}
          onScroll={loadMoreIfNeeded}
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
          {options.map((v) => (
            <button
              key={v.id}
              type="button"
              className="vendor-option"
              // onMouseDown, not onClick: the input's blur fires first on a click and would
              // unmount this list before the click ever landed on it.
              onMouseDown={() => {
                onChange(v);
                setOpen(false);
              }}
            >
              {vendorLabel(v)}
            </button>
          ))}
          {loading && (
            <div className="faint" style={{ padding: 10, fontSize: 13 }}>
              {options.length ? "Loading more…" : "Searching…"}
            </div>
          )}
          {!loading && options.length === 0 && (
            <div className="faint" style={{ padding: 10, fontSize: 13 }}>
              No vendor matches that.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Which field each validation message belongs under. `codes` covers RT and Delta together:
 *  the rule is "at least one of the two", and a clash can be on either. */
type FormErrors = Partial<Record<"vendor" | "codes" | "supplier", string>>;

export default function RawMaterialPage() {
  const { notify } = useToast();
  // Searched, sorted and paged by the server. Vendor is the sortable column, and the table
  // starts on it — never in an "unsorted" state (see nextSort in sorting.tsx).
  const { rows, total, page, setPage, search, setSearch, query, sort, setSort, loading, fetching, reload } =
    useServerPage<Row>((q) => vendorsApi.searchPapers(q), { key: "vendor", dir: "asc" });
  // The chosen vendor, for the picker to show; the form itself keeps just its id.
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  // Shown under the field each one belongs to, not as a toast.
  const [errors, setErrors] = useState<FormErrors>({});
  // null = closed, "new" = adding, otherwise the row being edited.
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  // Deleting splices a row out of its vendor's papers array — there is no undo, and a
  // roll booked against that RT code is left pointing at a paper nobody can look up.
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);

  const openCreate = () => {
    setForm(EMPTY);
    setVendor(null);
    setErrors({});
    setEditing("new");
  };

  const openEdit = (row: Row) => {
    setForm(toForm(row));
    setVendor(row.vendor);
    setErrors({});
    setEditing(row);
  };

  // Editing a field clears its own message, so the error disappears as soon as it's fixed.
  const setValue = <K extends keyof FormState>(field: K, value: FormState[K], clears: keyof FormErrors) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [clears]: undefined }));
  };

  /** The rules the backend also enforces, checked here so each message lands on its field. */
  const validate = (paper: VendorPaper): FormErrors => {
    const found: FormErrors = {};
    if (!form.vendorId) found.vendor = "Pick the vendor this raw material comes from.";
    if (!paper.royal_touche_code && !paper.delta_code) found.codes = "Enter an RT code or a Delta code.";
    // Checked after trimming: a field holding only spaces would otherwise pass as filled.
    if (!paper.supplier_code_number) found.supplier = "Enter the supplier code / name.";
    return found;
  };

  /**
   * The vendor's papers as they are now, with `row` checked to still be where the list saw
   * it. A row is addressed by its position, so if the vendor's papers changed since this
   * page loaded, editing "paper 12" would silently edit a different paper.
   */
  const freshPapers = async (row: Row): Promise<VendorPaper[]> => {
    const vendor = await vendorsApi.get(row.vendor.id);
    const papers = vendor.papers ?? [];
    const current = papers[row.index];
    if (!current || paperKey(current) !== paperKey(row.paper)) {
      throw new StaleRowError("This raw material changed since the list was loaded — reload and try again.");
    }
    return papers;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const paper = toPaper(form);
    const found = validate(paper);
    setErrors(found);
    if (Object.keys(found).length) return;

    const from = editing !== "new" && editing ? editing : null;
    const moving = Boolean(from && from.vendor.id !== form.vendorId);

    setSaving(true);
    try {
      // Read fresh, not from the page: the table only holds one page of rows, and the vendor
      // may have changed since it loaded.
      const target = await vendorsApi.get(form.vendorId);
      const targetPapers = from && !moving ? await freshPapers(from) : (target.papers ?? []);
      const sourcePapers = from && moving ? await freshPapers(from) : null;

      // Codes repeat across suppliers, but two rows with the same code under ONE supplier
      // would collide, because the backend merges a vendor's papers by code.
      const key = paperKey(paper);
      const clashes = targetPapers.some((p, i) => paperKey(p) === key && !(from && !moving && i === from.index));
      if (clashes) {
        setErrors({ codes: `${target.name} already has a raw material with this code.` });
        return;
      }

      const nextTarget =
        from && !moving ? targetPapers.map((p, i) => (i === from.index ? paper : p)) : [...targetPapers, paper];

      // Added to the new supplier before being removed from the old one. If the second call
      // fails the row is duplicated — visible, and deletable — rather than lost from both.
      await vendorsApi.update(target.id, { papers: nextTarget });
      if (from && sourcePapers) {
        await vendorsApi.update(from.vendor.id, { papers: sourcePapers.filter((_, i) => i !== from.index) });
      }

      await reload();
      setEditing(null);
      notify(from ? "Saved" : "Raw material added");
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      const papers = await freshPapers(deleting);
      await vendorsApi.update(deleting.vendor.id, { papers: papers.filter((_, i) => i !== deleting.index) });
      await reload();
      setDeleting(null);
      notify("Raw material removed");
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setDeletingNow(false);
    }
  };

  return (
    <div className="list-page">
      <PageHeader
        title="Paper Codes"
        subtitle="The Royal Touche paper codes, and the supplier each one comes from."
      />

      <div className="row gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Search by RT code, Delta code, supplier code or vendor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={15} /> Add raw material
        </button>
      </div>

      <div className="card list-page-scroll list-page-table-card" style={{ overflow: "hidden" }}>
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
                  <SortHeader
                    label="Vendor name"
                    sortKey="vendor"
                    sort={sort}
                    onToggle={(key) => setSort((prev) => nextSort(prev, key))}
                  />
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody style={fetching ? { opacity: 0.6 } : undefined}>
                {rows.map((row) => (
                  <tr key={`${row.vendor.id}:${row.index}`}>
                    <td>{row.paper.royal_touche_code || "—"}</td>
                    <td>{row.paper.delta_code || "—"}</td>
                    <td>{row.paper.supplier_code_number || "—"}</td>
                    <td>{row.vendor.name}</td>
                    <td>
                      <div className="row gap-8">
                        <button className="btn btn-sm" onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        {/* <button
                          className="btn btn-sm btn-ghost"
                          title="Delete raw material"
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 size={14} />
                        </button> */}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="faint" style={{ textAlign: "center", padding: 20 }}>
                      {query ? "Nothing matches that search." : "Nothing here yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={page} total={total} onChange={setPage} label="raw materials" />
          </div>
        )}
      </div>

      <Modal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this raw material?"
        size="medium"
      >
        {deleting && (
          <div style={{ display: "grid", gap: 14, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              This removes the paper from{" "}
              <strong>{deleting.vendor.name}</strong>. It cannot be undone — and any roll
              already booked against this code will point at a paper that no longer exists.
            </p>
            <div className="facts-grid">
              <div>
                <span className="faint">RT code</span>
                <strong>{deleting.paper.royal_touche_code || "—"}</strong>
              </div>
              <div>
                <span className="faint">Delta code</span>
                <strong>{deleting.paper.delta_code || "—"}</strong>
              </div>
              <div>
                <span className="faint">Supplier code</span>
                <strong>{deleting.paper.supplier_code_number || "—"}</strong>
              </div>
            </div>
            <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDelete}
                disabled={deletingNow}
              >
                {deletingNow ? "Deleting…" : "Delete raw material"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add raw material" : "Edit raw material"}
        size="medium"
      >
        {/* noValidate: the checks below show their message under the field, rather than the
            browser's own popup or a toast. */}
        <form onSubmit={submit} noValidate style={{ display: "grid", gap: 12, padding: 16 }}>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span className="faint">Vendor *</span>
            <VendorPicker
              selected={vendor}
              invalid={Boolean(errors.vendor)}
              onChange={(v) => {
                setVendor(v);
                setValue("vendorId", v.id, "vendor");
              }}
            />
            {errors.vendor && <span className="field-error">{errors.vendor}</span>}
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">RT code</span>
              <input
                className="input"
                aria-invalid={Boolean(errors.codes) || undefined}
                value={form.royal_touche_code}
                onChange={(e) => setValue("royal_touche_code", e.target.value, "codes")}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Delta code</span>
              <input
                className="input"
                aria-invalid={Boolean(errors.codes) || undefined}
                value={form.delta_code}
                onChange={(e) => setValue("delta_code", e.target.value, "codes")}
              />
            </label>
            {/* Under both code fields: the rule covers the pair, not either one alone. */}
            <span
              className={errors.codes ? "field-error" : "faint"}
              style={{ gridColumn: "1 / -1", marginTop: -6, fontSize: 12 }}
            >
              {errors.codes ?? "A raw material needs an RT code or a Delta code."}
            </span>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span className="faint">Supplier code / name *</span>
              <input
                className="input"
                aria-invalid={Boolean(errors.supplier) || undefined}
                value={form.supplier_code_number}
                onChange={(e) => setValue("supplier_code_number", e.target.value, "supplier")}
              />
              {errors.supplier && <span className="field-error">{errors.supplier}</span>}
            </label>
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
