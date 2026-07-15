import { useCallback, useEffect, useState } from "react";
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

export default function ExportPage() {
  const { notify } = useToast();
  const [columns, setColumns] = useState<Column[]>([]);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [status, setStatus] = useState<"all" | "verified">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

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

      <div style={{ maxWidth: 640 }}>
        <div className="card" style={{ padding: 20 }}>
          <label className="field-label">Columns to export ({enabledColumns.length} of {columns.length})</label>
          <div className="stack" style={{ gap: 2, marginBottom: 18 }}>
            {columns.map((c, i) => (
              <div key={c.key} className="row gap-8" style={{ padding: "7px 0" }}>
                <button
                  className="switch"
                  data-on={c.enabled}
                  onClick={() =>
                    setColumns((prev) => prev.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
                  }
                />
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={c.label}
                  onChange={(e) =>
                    setColumns((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </div>

          <div className="row gap-12" style={{ marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label className="field-label">Status</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as "all" | "verified")}>
                <option value="all">All</option>
                <option value="verified">Verified only</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="field-label">From</label>
              <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="field-label">To</label>
              <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          <label className="field-label">Export format</label>
          <div className="row gap-8" style={{ marginBottom: 18, flexWrap: "wrap" }}>
            <button className={`btn ${format === "csv" ? "btn-primary" : ""}`} onClick={() => setFormat("csv")}>CSV</button>
            <button className={`btn ${format === "xlsx" ? "btn-primary" : ""}`} onClick={() => setFormat("xlsx")}>Excel (.xlsx)</button>
            {/* <button className="btn" disabled title="Coming soon">QuickBooks</button>
            <button className="btn" disabled title="Coming soon">Xero</button> */}
          </div>

          <div className="row gap-12">
            <button className="btn btn-primary" onClick={generate} disabled={busy || enabledColumns.length === 0}>
              {busy ? "Generating…" : "Generate export"}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              {count != null ? `${count} documents match these filters` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
