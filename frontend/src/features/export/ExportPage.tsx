import { useCallback, useEffect, useState } from "react";
import { GripVertical, SlidersHorizontal, Filter, Calendar, FileText, FileSpreadsheet, Download } from "lucide-react";
import { exportApi } from "../../api/export.api";
import { fieldDefinitionsApi } from "../../api/fieldDefinitions.api";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../api/client";
import { PageHeader } from "../../components/ui";

interface Column {
  key: string;
  label: string;
  enabled: boolean;
}

const FORMATS = [
  { value: "csv" as const, label: "CSV", caption: "", icon: FileText },
  { value: "xlsx" as const, label: "Excel", caption: "", icon: FileSpreadsheet },
];

/** Moves the item at `from` to sit at `to`, shifting everything between the two
 * positions to close the gap — a plain splice-out/splice-in does this for free. */
function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export default function ExportPage() {
  const { notify } = useToast();
  const [columns, setColumns] = useState<Column[]>([]);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [status, setStatus] = useState<"all" | "verified">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    fieldDefinitionsApi
      .list()
      .then((defs) =>
        setColumns(defs.filter((d) => d.enabled).map((d) => ({ key: d.key, label: d.label, enabled: true }))),
      )
      .catch((err) => notify(apiErrorMessage(err), "error"));
  }, [notify]);

  const filters = useCallback(
    () => ({ status, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    [status, dateFrom, dateTo],
  );

  useEffect(() => {
    exportApi
      .previewCount(filters())
      .then(setCount)
      .catch(() => setCount(null));
  }, [filters]);

  const enabledColumns = columns.filter((c) => c.enabled);

  const dropAt = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = reorder(columns, dragIndex, targetIndex);
    setColumns(next);
    setDragIndex(null);
    setOverIndex(null);
    fieldDefinitionsApi.reorder(next.map((c) => c.key)).catch((err) => notify(apiErrorMessage(err), "error"));
  };

  const generate = async () => {
    setBusy(true);
    try {
      await exportApi.generate({
        format,
        ...filters(),
        columns: enabledColumns.map((c) => ({ key: c.key, label: c.label })),
      });
      notify("Export downloaded");
    } catch (err) {
      notify(apiErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Export" subtitle="Generate a spreadsheet of your extracted invoices." />

      <div>
        <div className="stack" style={{ gap: 20 }}>
          {/* Filters section: Status/From/To, then Export format, then Generate */}
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: 16 }}>
              <div className="row gap-8" style={{ marginBottom: 14 }}>
                <Filter size={15} style={{ color: "var(--text-muted)" }} />
                <span className="field-label" style={{ margin: 0 }}>Filters</span>
              </div>

              <div className="row gap-12" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label className="field-label">Status</label>
                  <select className="select" value={status} onChange={(e) => setStatus(e.target.value as "all" | "verified")}>
                    <option value="all">All</option>
                    <option value="verified">Verified only</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label className="field-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={12} /> From
                  </label>
                  <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label className="field-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={12} /> To
                  </label>
                  <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            <div style={{ padding: 20 }}>
              <label className="field-label">Export format</label>
              <div className="row gap-8" style={{ flexWrap: "wrap" }}>
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    className="export-format-option"
                    data-active={format === f.value}
                    onClick={() => setFormat(f.value)}
                  >
                    <f.icon size={18} />
                    <span className="stack" style={{ gap: 1, alignItems: "flex-start" }}>
                      <strong style={{ fontSize: 13 }}>{f.label}</strong>
                      <span className="faint" style={{ fontSize: 11 }}>{f.caption}</span>
                    </span>
                  </button>
                ))}
                {/* <button className="btn" disabled title="Coming soon">QuickBooks</button>
                <button className="btn" disabled title="Coming soon">Xero</button> */}
              </div>
            </div>

            <div
              className="row gap-12"
              style={{ padding: "14px 20px", background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}
            >
              <button className="btn btn-primary" onClick={generate} disabled={busy || enabledColumns.length === 0}>
                <Download size={14} />
                {busy ? "Generating…" : "Generate export"}
              </button>
              {count != null && (
                <span className="pill pill-archived">{count} document{count === 1 ? "" : "s"} match</span>
              )}
            </div>
          </div>

          {/* Columns to export section: fixed-height scroll area so a long field list doesn't
              push the rest of the page down */}
          <div className="card" style={{ padding: 20 }}>
            <div className="row gap-8" style={{ marginBottom: 14 }}>
              <SlidersHorizontal size={15} style={{ color: "var(--text-muted)" }} />
              <span className="field-label" style={{ margin: 0 }}>
                Columns to export ({enabledColumns.length} of {columns.length})
              </span>
            </div>
            <div className="stack export-columns-scroll" style={{ gap: 2 }}>
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className="row gap-8"
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (overIndex !== i) setOverIndex(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropAt(i);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  style={{
                    padding: "7px 4px",
                    borderRadius: 6,
                    cursor: "grab",
                    opacity: dragIndex === i ? 0.4 : 1,
                    outline: overIndex === i && dragIndex !== null && dragIndex !== i ? "2px solid var(--brand)" : "none",
                    outlineOffset: -2,
                  }}
                >
                  <GripVertical size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <span className="faint" style={{ fontSize: 12, width: 18, textAlign: "right", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <button
                    className="switch"
                    data-on={c.enabled}
                    onClick={() =>
                      setColumns((prev) => prev.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
                    }
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: 14,
                      padding: "6px 2px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .export-format-option {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; flex: 1; min-width: 150px;
          border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          background: var(--surface); color: var(--text-muted);
          transition: border-color 0.12s, background 0.12s, color 0.12s;
        }
        .export-format-option svg { color: var(--text-muted); flex-shrink: 0; transition: color 0.12s; }
        .export-format-option:hover { border-color: var(--border-strong); background: var(--surface-2); }
        .export-format-option[data-active="true"] {
          border-color: var(--brand); background: var(--brand-soft); color: var(--text);
        }
        .export-format-option[data-active="true"] svg { color: var(--brand-strong); }
        .export-columns-scroll {
          max-height: 380px; overflow-y: auto;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          padding: 6px 10px;
        }
      `}</style>
    </div>
  );
}
