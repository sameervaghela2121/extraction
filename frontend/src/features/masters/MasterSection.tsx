import { useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Plus, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { Modal, PageHeader, Spinner } from "../../components/ui";
import Pager, { PAGE_SIZE } from "./Pager";
import { nextSort, SortHeader, type Sort } from "./sorting";
import { useServerPage } from "./useServerPage";
import type { MasterRow, MasterSpec } from "./specs";

/**
 * One `<tr>` that can be picked up by its handle.
 *
 * Pointer-based (dnd-kit), not the browser's native HTML5 drag-and-drop: native drag events
 * turned out flaky in practice — a tiny handle is easy to miss, and dragover doesn't bubble
 * consistently enough across browsers to reorder reliably. dnd-kit tracks the pointer
 * directly instead, which is what makes the row follow the cursor smoothly and drop where
 * you'd expect every time.
 *
 * `disabled` still mounts the sortable (so `SortableContext`'s id list stays stable whether
 * or not dragging is currently allowed) but renders no handle to grab, which is simpler than
 * switching between two different row implementations depending on `canDrag`.
 */
function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    background: isDragging ? "var(--surface-2)" : undefined,
  };
  const handle = disabled ? null : (
    <span
      ref={setActivatorNodeRef}
      {...listeners}
      {...attributes}
      className="drag-handle"
      title="Drag to reorder"
    >
      <GripVertical size={15} />
    </span>
  );
  return (
    <tr ref={setNodeRef} style={style}>
      {children(handle)}
    </tr>
  );
}

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
  /**
   * Starts on the sortable column, ascending — never in an "unsorted" state (see nextSort).
   * A reorderable master starts on sort_order instead: that is the order dragging acts on,
   * and the order its picker shows. MasterDataPage remounts this per section, so this is
   * computed afresh for each master.
   */
  const initialSort: Sort = spec.reorderable
    ? { key: "sort_order", dir: "asc" }
    : (() => {
        const first = spec.fields.find((f) => f.inList && f.sortable);
        return first ? { key: first.name, dir: "asc" } : null;
      })();
  // Searched, sorted and paged by the server: one request per page, nothing held in memory
  // beyond the rows on screen.
  const { rows, setRows, total, page, setPage, search, setSearch, query, sort, setSort, loading, fetching, reload } =
    useServerPage<MasterRow>((q) => spec.api.search(q), initialSort);
  // null = closed, "new" = create, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  // Dragging edits the sort_order sequence, so it is only offered while the table shows that
  // sequence unfiltered. It works within the current page; the server slots the page's new
  // order back into the full list, so rows on other pages keep their place.
  const canDrag =
    Boolean(spec.reorderable) && !search.trim() && !query && sort?.key === "sort_order" && sort.dir === "asc";
  const [reordering, setReordering] = useState(false);
  // A few pixels of slop before a drag starts, so clicking the handle (or a button
  // elsewhere in the row) never gets mistaken for the beginning of a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const toggleSort = (key: string) => setSort((prev) => nextSort(prev, key));

  /** Move the dropped row within this page, then save the page's new order. Applied
   *  optimistically, and inside flushSync: dnd-kit animates the drop synchronously from
   *  SortableContext's current `items`, so a plain setRows (applied on the next render)
   *  would show the row snapping back for a frame before jumping to its new place. The page
   *  is reloaded either way, so a failed save shows the order the server actually has. */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.id === active.id);
    const newIndex = rows.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(rows, oldIndex, newIndex);
    flushSync(() => setRows(next));
    setReordering(true);
    try {
      await spec.api.reorder(
        next.map((r) => r.id),
        (page - 1) * PAGE_SIZE,
      );
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      await reload();
      setReordering(false);
    }
  };

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
      if (editing === "new") await spec.api.create(body);
      else await spec.api.update(editing!, body);
      // Reloaded rather than patched in: a new or edited row may belong on another page, or
      // no longer match the search.
      await reload();
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
    <div className="list-page">
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

      <div className="card list-page-scroll list-page-table-card" style={{ overflow: "hidden" }}>
        {loading ? (
          <Spinner />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {canDrag && <th style={{ width: 32 }}></th>}
                  {columns.map((c) =>
                    c.sortable ? (
                      <SortHeader
                        key={c.name}
                        label={c.label}
                        sortKey={c.name}
                        sort={sort}
                        onToggle={toggleSort}
                      />
                    ) : (
                      <th key={c.name}>{c.label}</th>
                    ),
                  )}
                  <th>Status</th>
                  <th style={{ width: 150 }}></th>
                </tr>
              </thead>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={rows.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody style={reordering || fetching ? { opacity: 0.6 } : undefined}>
                    {rows.map((row) => (
                      <SortableRow key={row.id} id={row.id} disabled={!canDrag}>
                        {(handle) => (
                          <>
                            {canDrag && <td>{handle}</td>}
                            {columns.map((c) => (
                              <td key={c.name}>{String(row[c.name] ?? "—")}</td>
                            ))}
                            <td style={{ textTransform: "capitalize" }}>{row.status}</td>
                            <td>
                              <div className="row gap-8">
                                <button className="btn btn-sm" onClick={() => openEdit(row)}>
                                  Edit
                                </button>
                                <button
                                  className={`btn btn-sm ${row.status === "active" ? "btn-danger" : "btn-success"}`}
                                  onClick={() => toggleStatus(row)}
                                >
                                  {row.status === "active" ? "Deactivate" : "Activate"}
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </SortableRow>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={columns.length + 2 + (canDrag ? 1 : 0)}
                          className="faint"
                          style={{ textAlign: "center", padding: 20 }}
                        >
                          {query ? "Nothing matches that search." : "Nothing here yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </SortableContext>
              </DndContext>
            </table>
            <Pager page={page} total={total} onChange={setPage} label={spec.plural} />
            {canDrag && (
              <div className="faint" style={{ fontSize: 12, padding: "0 12px 10px" }}>
                Drag the handle to reorder{total > PAGE_SIZE ? " rows on this page" : ""}.
              </div>
            )}
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
            {spec.fields.filter((f) => !f.readOnly).map((f) => (
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
