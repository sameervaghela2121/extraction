import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import { reportsApi, type ConsumptionFigures, type ConsumptionGroup, type ConsumptionSummary } from "../../api/reports.api";
import { Spinner } from "../../components/ui";
import { useToast } from "../../context/ToastContext";

type Period = "day" | "week" | "month";
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

/** en-CA formats as YYYY-MM-DD, in the local day rather than UTC's. */
const iso = (date: Date) => date.toLocaleDateString("en-CA");

/** The whole period around a picked day. A week runs Monday to Sunday. Worked out at noon so a
 *  clock change can't move the day. */
function rangeOf(period: Period, picked: string): { from: string; to: string } {
  const day = new Date(`${picked}T12:00:00`);
  if (period === "day") return { from: picked, to: picked };
  if (period === "week") {
    const sinceMonday = (day.getDay() + 6) % 7;
    const monday = new Date(day);
    monday.setDate(day.getDate() - sinceMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: iso(monday), to: iso(sunday) };
  }
  return {
    from: iso(new Date(day.getFullYear(), day.getMonth(), 1, 12)),
    to: iso(new Date(day.getFullYear(), day.getMonth() + 1, 0, 12)),
  };
}

const GROUPS: Array<{ key: ConsumptionGroup; label: string }> = [
  { key: "material", label: "By material" },
  { key: "design", label: "By design" },
];

const COLUMNS: Array<{ key: keyof ConsumptionFigures; label: string }> = [
  { key: "opening", label: "Opening" },
  { key: "received", label: "Received" },
  { key: "consumed", label: "Consumed" },
  { key: "returned_to_vendor", label: "Returned to vendor" },
  { key: "sold", label: "Sold" },
  { key: "adjusted", label: "Adjusted" },
  { key: "closing", label: "Closing" },
  { key: "out_at_close", label: "Out on floor" },
];

const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/**
 * Consumption by material or design for a day, week or month, in kg, adding up from opening
 * stock to closing stock. Unlike the daily report, it counts every movement in the period, not just each
 * roll's last. The roll detail download is the proof behind the Consumed column.
 */
export default function ConsumptionReportPage() {
  const { notify } = useToast();
  const [period, setPeriod] = useState<Period>("day");
  const [group, setGroup] = useState<ConsumptionGroup>("material");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(() => iso(new Date()));
  const [summary, setSummary] = useState<ConsumptionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const { from, to } = picked ? rangeOf(period, picked) : { from: "", to: "" };

  useEffect(() => {
    setSummary(null);
    if (!from) return;
    // Only the latest period's answer counts, if an earlier request lands after it.
    let current = true;
    setLoading(true);
    reportsApi
      .consumption(from, to, group)
      .then((res) => current && setSummary(res))
      .catch((err) => current && notify(apiErrorMessage(err), "error"))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [from, to, group, notify]);

  const download = async (save: () => Promise<void>) => {
    setBusy(true);
    try {
      await save();
      notify("Report downloaded");
    } catch (err) {
      notify(apiErrorMessage(err, "The report could not be downloaded"), "error");
    } finally {
      setBusy(false);
    }
  };

  const hasRows = Boolean(summary?.rows.length);

  // Designs run to hundreds, so they can be searched by either code. The loaded answer may still
  // be the other grouping's for a moment after switching, hence reading its own group.
  const byDesign = summary?.group === "design";
  const shownRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!summary || !byDesign || !q) return summary?.rows ?? [];
    return summary.rows.filter(
      (row) => row.rt_code?.toLowerCase().includes(q) || row.delta_code?.toLowerCase().includes(q),
    );
  }, [summary, byDesign, search]);

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="row gap-12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="row gap-8" role="group" aria-label="Period">
            {PERIODS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn ${period === option.key ? "btn-primary" : ""}`}
                aria-pressed={period === option.key}
                onClick={() => setPeriod(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="row gap-8" role="group" aria-label="Group by">
            {GROUPS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn ${group === option.key ? "btn-primary" : ""}`}
                aria-pressed={group === option.key}
                onClick={() => setGroup(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div>
            <label className="field-label" htmlFor="consumption-date">
              {period === "day" ? "Date" : period === "week" ? "Any day in the week" : "Any day in the month"}
            </label>
            <input
              id="consumption-date"
              className="input"
              type="date"
              max={iso(new Date())}
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
            />
          </div>
          {from && (
            <span className="faint" style={{ paddingBottom: 10 }}>
              {from === to ? from : `${from} to ${to}`}
            </span>
          )}
          <div className="spacer" />
          <button
            type="button"
            className="btn"
            disabled={busy || !hasRows}
            onClick={() => download(() => reportsApi.downloadConsumptionSummary(from, to, group))}
          >
            <Download size={14} /> Summary CSV
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !summary?.totals.consumed}
            onClick={() => download(() => reportsApi.downloadConsumptionDetail(from, to))}
          >
            <Download size={14} /> Roll detail CSV
          </button>
        </div>
      </div>

      {byDesign && hasRows && (
        <input
          className="input"
          style={{ marginBottom: 12, maxWidth: 360 }}
          placeholder="Search by RT or Delta code"
          aria-label="Search by RT or Delta code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <Spinner />
        ) : !hasRows ? (
          <p className="muted" style={{ textAlign: "center", padding: 24, margin: 0 }}>
            No stock or movements in this period.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {byDesign ? (
                    <>
                      <th>RT code</th>
                      <th>Delta code</th>
                      <th>Vendor</th>
                    </>
                  ) : null}
                  <th>Material</th>
                  {COLUMNS.map((column) => (
                    <th key={column.key} style={{ textAlign: "right" }}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((row) => (
                  <tr key={byDesign ? `${row.rt_code}|${row.delta_code}` : row.material_code}>
                    {byDesign ? (
                      <>
                        <td style={{ fontWeight: 600 }}>{row.rt_code || "—"}</td>
                        <td>{row.delta_code || "—"}</td>
                        <td>{row.vendor}</td>
                      </>
                    ) : null}
                    <td>{row.material}</td>
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: column.key === "consumed" ? 600 : undefined,
                        }}
                      >
                        {number(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {shownRows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 4} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No design matches this search.
                    </td>
                  </tr>
                )}
                {/* The whole period's total, so it would misread against a searched list. */}
                {!(byDesign && search.trim()) && (
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={byDesign ? 4 : 1}>Total</td>
                    {COLUMNS.map((column) => (
                      <td key={column.key} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {number(summary!.totals[column.key])}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
