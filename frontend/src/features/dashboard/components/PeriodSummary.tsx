import { Link } from "react-router-dom";
import type { ConsumptionFigures } from "../../../api/reports.api";
import { kg, shortDate } from "../format";

const COLUMNS: Array<{
  key: keyof ConsumptionFigures;
  label: string;
  tone?: "muted" | "brand" | "success" | "warning";
}> = [
  { key: "opening", label: "Opening", tone: "muted" },
  { key: "received", label: "Received", tone: "brand" },
  { key: "consumed", label: "Consumed" },
  { key: "returned_to_vendor", label: "RTV", tone: "warning" },
  { key: "sold", label: "Sold", tone: "brand" },
  { key: "adjusted", label: "Adjusted" },
  { key: "closing", label: "Closing", tone: "success" },
  { key: "out_at_close", label: "Out on floor", tone: "warning" },
];

function periodLabel(from: string, to: string) {
  if (from === to) return shortDate(from);
  return `${shortDate(from)} – ${shortDate(to)}`;
}

export default function PeriodSummary({
  totals,
  from,
  to,
}: {
  totals: ConsumptionFigures;
  from: string;
  to: string;
}) {
  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2 className="dashboard-panel-title">Period stock movement</h2>
          <p className="muted dashboard-panel-sub">
            {periodLabel(from, to)} · all figures in kg
          </p>
        </div>
        <Link to="/reports/consumption" className="btn btn-sm">
          Open full report
        </Link>
      </div>
      <div className="dashboard-period-grid">
        {COLUMNS.map((col) => {
          const value = kg(totals[col.key]);
          const long = value.length >= 8;
          return (
            <div
              key={col.key}
              className={[
                "dashboard-period-cell",
                col.tone ? `dashboard-period-cell--${col.tone}` : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="dashboard-kpi-label">{col.label}</div>
              <div
                className={`dashboard-period-value${long ? " is-compact" : ""}`}
                title={`${value} kg`}
              >
                {value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
