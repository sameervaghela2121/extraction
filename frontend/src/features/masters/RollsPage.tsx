import { useEffect, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { rollsApi } from "../../api/rolls.api";
import { stockApi } from "../../api/stock.api";
import { locationsApi, materialTypesApi } from "../../api/masters.api";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import { nextSort, SortHeader, type Sort } from "./sorting";
import type {
  GodownLocation,
  MaterialRoll,
  MaterialType,
  StockMovement,
} from "../../types";

/**
 * Rolls — edit and delete only. Registration happens on the phone, where the camera and the
 * physical roll are; this screen exists to correct what was typed there.
 *
 * Two rules from the API shape the whole form:
 *
 *  - `remaining_weight` and `status` cannot be PATCHed. A stock figure that moved with no
 *    ledger row behind it is a number nobody can explain later, so the current weight is
 *    corrected through an ADJUSTMENT movement instead — which is why saving one demands a
 *    reason.
 *  - `weight` is the roll's arrival ceiling. It stays editable only while the roll has not
 *    moved, decided from its history rather than its numbers (see loadHistory).
 */

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<MaterialRoll["status"], string> = {
  IN_STOCK: "In stock",
  ISSUED: "Issued",
  CONSUMED: "Consumed",
};

/** The tablet's three status colours: in stock is green, out is red, finished is grey. */
const STATUS_CLASS: Record<MaterialRoll["status"], string> = {
  IN_STOCK: "status-in",
  ISSUED: "status-out",
  CONSUMED: "status-consumed",
};

interface FormState {
  material_id: string;
  location: string;
  gsm: string;
  width: string;
  weight: string;
  remaining_weight: string;
}

function toForm(roll: MaterialRoll): FormState {
  return {
    material_id: roll.material_id.id,
    location: roll.location,
    gsm: String(roll.gsm),
    width: String(roll.width),
    weight: String(roll.weight),
    remaining_weight: String(roll.remaining_weight ?? 0),
  };
}

export default function RollsPage() {
  const { notify } = useToast();
  const [rolls, setRolls] = useState<MaterialRoll[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  /**
   * Sorted server-side, unlike the master tables.
   *
   * This list is paged by the API, so ordering the rows already on screen would reorder 25
   * of however many thousand and quietly lie about the rest.
   *
   * Ordered by the date received, newest first — the most recently added roll is the one
   * someone is usually looking for. The control sits on the Roll number column because
   * that is the column identifying the row; alphabetical order of mill numbers like
   * "DP24" and "R9863" is not something anyone wants to read a roll list in.
   */
  const [sort, setSort] = useState<Sort>({ key: "date", dir: "desc" });

  const [editing, setEditing] = useState<MaterialRoll | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  // Deleting takes the roll's whole ledger with it, so this asks properly rather than with
  // an inline second click — and names how many movements are about to go, because "3
  // movements" and "this roll never moved" deserve different amounts of hesitation.
  const [deleting, setDeleting] = useState<MaterialRoll | null>(null);
  const [deleteMovements, setDeleteMovements] = useState<number | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);

  // The open roll's ledger. `movementCount` is what decides whether weight stays editable —
  // null while it is still loading, so the field is disabled rather than briefly wrong.
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [movementCount, setMovementCount] = useState<number | null>(null);

  const [materials, setMaterials] = useState<MaterialType[]>([]);
  const [locations, setLocations] = useState<GodownLocation[]>([]);

  const load = async (targetPage = page, q = search) => {
    setLoading(true);
    try {
      const res = await rollsApi.listFull({
        q: q.trim() || undefined,
        sort: (sort?.key as "roll_number" | "date") ?? undefined,
        order: sort?.dir,
        page: targetPage,
        pageSize: PAGE_SIZE,
      });
      setRolls(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  // Debounced, and server-side: this endpoint pages, so every keystroke is a real query
  // rather than a filter over rows already in memory. Skipped on the first run — the page
  // effect below already loads there, and without this both fire and the screen opens with
  // two identical requests in flight.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(() => {
      setPage(1);
      load(1, search);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    load(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    setPage(1);
    load(1, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  // The two pickers. Both masters are read whole, so this is one call each, once.
  useEffect(() => {
    (async () => {
      try {
        const [m, l] = await Promise.all([materialTypesApi.list(), locationsApi.list()]);
        setMaterials(m.filter((x) => x.status === "active"));
        setLocations(l.filter((x) => x.status === "active"));
      } catch (err) {
        notify(apiErrorMessage(err), "error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Whether this roll has ever moved.
   *
   * Registration always writes exactly one IN row, so a total of 1 means nothing has
   * happened since the roll arrived. Counting rows rather than comparing weights is
   * deliberate: a roll issued out and returned with nothing used ends up with its weights
   * unchanged, and a weight comparison would call that untouched.
   *
   * `<= 1` rather than `=== 1` so a roll registered before the automatic IN existed, which
   * has no rows at all, is not locked forever for no reason.
   */
  const loadHistory = async (roll: MaterialRoll) => {
    setHistory([]);
    setMovementCount(null);
    try {
      const res = await stockApi.movements({ roll_id: roll.id, pageSize: 20 });
      setHistory(res.items);
      setMovementCount(res.total);
    } catch (err) {
      notify(apiErrorMessage(err), "error");
      // Left null: unknown is treated as "not editable", which is the safe direction.
    }
  };

  const openEdit = (roll: MaterialRoll) => {
    setEditing(roll);
    setForm(toForm(roll));
    loadHistory(roll);
  };

  /**
   * Has this roll moved? Decided from its ledger and nothing else.
   *
   * Deliberately not "do its two weights still agree" — a roll issued out and returned with
   * nothing used comes back with identical numbers, and a weight comparison would call that
   * untouched. It would also refuse single-field mode on exactly the rolls a bad earlier
   * save has left mismatched, which are the ones that need repairing.
   *
   * An untouched roll shows ONE weight field. Its arrival weight and its current weight are
   * the same number, because nothing has been drawn off it — and two inputs bound by that
   * invariant will eventually break it.
   */
  const untouched = movementCount !== null && movementCount <= 1;

  /**
   * A finished roll's weight is not correctable.
   *
   * CONSUMED means the core came back empty, so the figure is 0 by definition. Editing it
   * produced a roll marked Consumed carrying stock — a state no sequence of movements can
   * reach, because `status` follows the ledger and a direct correction does not touch it.
   */
  const weightLocked = editing?.status === "CONSUMED";
  const lockReason = "This roll is consumed, so its weight can no longer be changed.";

  const setValue = (field: keyof FormState, value: string) =>
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !form) return;

    const newWeight = Number(form.weight);

    const patch: Record<string, unknown> = {};
    if (form.material_id !== editing.material_id.id) patch.material_id = form.material_id;
    if (form.location !== editing.location) patch.location = form.location;
    if (Number(form.gsm) !== editing.gsm) patch.gsm = Number(form.gsm);
    if (Number(form.width) !== editing.width) patch.width = Number(form.width);

    // Guarded here as well as on the input: a disabled field is a UI convention, not a
    // rule, and the submit path is what actually writes.
    if (weightLocked) {
      // Nothing weight-related may go, whichever branch the form was showing.
    } else if (untouched) {
      // One field on screen, both figures behind it: a roll that has not moved holds exactly
      // what arrived on it. Sent together in a single PATCH so they cannot drift apart.
      if (newWeight !== editing.weight) {
        patch.weight = newWeight;
        patch.remaining_weight = newWeight;
      }
    } else {
      // Weight is locked on a roll that has moved; only the current figure is correctable.
      const newRemaining = Number(form.remaining_weight);
      if (newRemaining !== (editing.remaining_weight ?? 0)) patch.remaining_weight = newRemaining;
    }

    if (Object.keys(patch).length === 0) {
      notify("Nothing changed.");
      return;
    }

    setSaving(true);
    try {
      // One request, and nothing is written to the ledger. Correcting a figure that was
      // mistyped at registration is not a stock movement, so it leaves no row behind it —
      // the roll's history stays exactly as the warehouse recorded it.
      await rollsApi.update(editing.id, patch);
      await load();
      setEditing(null);
      notify("Saved");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const askDelete = async (roll: MaterialRoll) => {
    setDeleting(roll);
    setDeleteMovements(null);
    try {
      const res = await stockApi.movements({ roll_id: roll.id, pageSize: 1 });
      setDeleteMovements(res.total);
    } catch {
      // The count is what makes the warning concrete, not what makes it correct — a failed
      // lookup falls back to the general wording rather than blocking the delete.
      setDeleteMovements(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingNow(true);
    try {
      await rollsApi.remove(deleting.id);
      notify(`Roll ${deleting.roll_number} deleted`);
      setDeleting(null);
      await load();
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setDeletingNow(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Rolls"
        subtitle="Rolls received into the godown. Registration happens on the app — this is for correcting it."
      />

      <div className="row gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Search by roll number or RT code"
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
                  {/* Sorts by date received, not by the number itself — see `sort` above. */}
                  <SortHeader
                    label="Roll number"
                    sortKey="date"
                    sort={sort}
                    onToggle={(key) => setSort((prev) => nextSort(prev, key))}
                  />
                  <th>RT code</th>
                  <th>Current weight</th>
                  <th>Status</th>
                  <th style={{ width: 170 }}></th>
                </tr>
              </thead>
              <tbody>
                {rolls.map((roll) => (
                  <tr key={roll.id}>
                    <td style={{ fontWeight: 600 }}>{roll.roll_number}</td>
                    <td>{roll.royal_touche_code || "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {roll.remaining_weight ?? 0} {roll.unit}
                    </td>
                    <td>
                      <span className={`status ${STATUS_CLASS[roll.status]}`}>
                        {STATUS_LABEL[roll.status]}
                      </span>
                    </td>
                    <td>
                      <div className="row gap-8">
                        {/* A finished roll has nothing left to correct: its weight is 0 by
                            definition and it will never move again. Disabled outright
                            rather than opening a form where every field is locked. */}
                        <button
                          className="btn btn-sm"
                          onClick={() => openEdit(roll)}
                          disabled={roll.status === "CONSUMED"}
                          title={
                            roll.status === "CONSUMED"
                              ? "This roll is consumed, so it can no longer be edited."
                              : undefined
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="Delete this roll"
                          onClick={() => askDelete(roll)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rolls.length === 0 && (
                  <tr>
                    <td colSpan={5} className="faint" style={{ textAlign: "center", padding: 20 }}>
                      {search ? "No rolls match that search." : "No rolls yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div
              className="row gap-8"
              style={{ justifyContent: "space-between", padding: "10px 12px", flexWrap: "wrap" }}
            >
              <span className="faint" style={{ fontSize: 12 }}>
                {total} roll{total === 1 ? "" : "s"}
              </span>
              <div className="row gap-8">
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Prev
                </button>
                <span className="faint" style={{ fontSize: 12 }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete roll ${deleting.roll_number}?` : "Delete roll"}
        size="medium"
      >
        {deleting && (
          <div style={{ display: "grid", gap: 14, padding: 16 }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              This deletes the <strong>roll and its entire history</strong>.
            </p>

            <div className="roll-readonly">
              <div>
                <span className="faint">RT code</span>
                <strong>{deleting.royal_touche_code || "—"}</strong>
              </div>
              <div>
                <span className="faint">Current weight</span>
                <strong>
                  {deleting.remaining_weight ?? 0} {deleting.unit}
                </strong>
              </div>
              <div>
                <span className="faint">Status</span>
                <strong>{STATUS_LABEL[deleting.status]}</strong>
              </div>
              <div>
                <span className="faint">History</span>
                <strong>
                  {deleteMovements === null
                    ? "…"
                    : `${deleteMovements} movement${deleteMovements === 1 ? "" : "s"}`}
                </strong>
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
                {deletingNow ? "Deleting…" : "Delete roll and history"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit roll ${editing.roll_number}` : "Edit roll"}
        size="large"
      >
        {editing && form && (
          <form onSubmit={submit} style={{ display: "grid", gap: 14, padding: 16 }}>
            {/* Read only: roll_number, RT code and barcode are read off the physical roll,
                and status follows the roll's movements. */}
            <div className="roll-readonly">
              <div>
                <span className="faint">Roll number</span>
                <strong>{editing.roll_number}</strong>
              </div>
              <div>
                <span className="faint">RT code</span>
                <strong>{editing.royal_touche_code || "—"}</strong>
              </div>
              <div>
                <span className="faint">Barcode</span>
                <strong>{editing.barcode || "—"}</strong>
              </div>
              <div>
                <span className="faint">Status</span>
                <strong>{STATUS_LABEL[editing.status]}</strong>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="faint">Material *</span>
                <select
                  className="input"
                  value={form.material_id}
                  onChange={(e) => setValue("material_id", e.target.value)}
                  required
                >
                  {/* The roll's own material is offered even when it has since been
                      deactivated, so opening the form doesn't silently re-point the roll. */}
                  {!materials.some((m) => m.id === form.material_id) && (
                    <option value={form.material_id}>{editing.material_id.name ?? "—"}</option>
                  )}
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.material_code} · {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="faint">Location *</span>
                <select
                  className="input"
                  value={form.location}
                  onChange={(e) => setValue("location", e.target.value)}
                  required
                >
                  {!locations.some((l) => l.name === form.location) && (
                    <option value={form.location}>{form.location}</option>
                  )}
                  {locations.map((l) => (
                    <option key={l.id} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="faint">GSM *</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.gsm}
                  onChange={(e) => setValue("gsm", e.target.value)}
                  required
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span className="faint">Width (mm) *</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.width}
                  onChange={(e) => setValue("width", e.target.value)}
                  required
                />
              </label>

              {movementCount === null ? (
                /* History not back yet. One disabled field rather than the two-field layout,
                   which would flash and then rearrange the moment the count arrives. */
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span className="faint">Weight ({editing.unit})</span>
                  <input className="input" type="number" value={form.weight} disabled />
                  <span className="faint" style={{ fontSize: 11 }}>
                    Checking this roll's history…
                  </span>
                </label>
              ) : untouched ? (
                /* Nothing has been drawn off this roll, so arrival weight and current
                   weight are one number. Editing it moves both. */
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span className="faint">Weight ({editing.unit}) *</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="any"
                    value={form.weight}
                    onChange={(e) => setValue("weight", e.target.value)}
                    required
                    disabled={weightLocked}
                    title={weightLocked ? lockReason : undefined}
                  />
                  <span className="faint" style={{ fontSize: 11 }}>
                    {weightLocked
                      ? lockReason
                      : "This roll has not moved, so this is both what arrived and what is on it now."}
                  </span>
                </label>
              ) : (
                <>
                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    <span className="faint">Weight on arrival ({editing.unit})</span>
                    <input className="input" type="number" value={form.weight} disabled />
                    <span className="faint" style={{ fontSize: 11 }}>
                      Locked — this roll has already moved.
                    </span>
                  </label>

                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    <span className="faint">Current weight ({editing.unit}) *</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      value={form.remaining_weight}
                      onChange={(e) => setValue("remaining_weight", e.target.value)}
                      required
                      disabled={weightLocked}
                      title={weightLocked ? lockReason : undefined}
                    />
                    <span className="faint" style={{ fontSize: 11 }}>
                      {weightLocked
                        ? lockReason
                        : "Corrected on the roll — no new movement; the last history row's balance follows it."}
                    </span>
                  </label>
                </>
              )}
            </div>

            <div>
              <strong style={{ fontSize: 13 }}>History</strong>
              {movementCount === null ? (
                <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  Loading…
                </p>
              ) : history.length === 0 ? (
                <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  Nothing recorded against this roll.
                </p>
              ) : (
                <div className="stack" style={{ gap: 4, marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
                  {history.map((m) => (
                    <div key={m.id} className="roll-history-row">
                      <span className="faint" style={{ fontSize: 12, minWidth: 74 }}>
                        {new Date(m.transaction_date).toLocaleDateString()}
                      </span>
                      {/* Rendered as-is: the server writes this sentence precisely so no
                          client has to rebuild it from the numbers. */}
                      <span style={{ fontSize: 13 }}>{m.description}</span>
                      <div className="spacer" />
                      <span className="faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                        {m.roll_weight_after ?? "—"} {editing.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
        )}
      </Modal>

      <style>{`
        /* IN / OUT / CONSUMED now come from the shared .status classes in global.css,
           which carry the same palette the tablet app uses. */
        .roll-readonly {
          display: grid; gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          padding: 12px; border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .roll-readonly > div { display: grid; gap: 2px; }
        .roll-readonly span { font-size: 11px; }
        .roll-readonly strong { font-size: 13px; }
        .roll-history-row {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-2);
        }
      `}</style>
    </div>
  );
}
