import { Link } from "react-router-dom";
import type { ConsumptionFigures } from "../../../api/reports.api";
import { kgLabel, shortDate } from "../format";

const COLUMNS: Array<{
  key: keyof ConsumptionFigures;
  label: string;
  hint: string;
  tone?: "muted" | "brand" | "success" | "warning" | "danger";
}> = [
  { key: "opening", label: "Opening stock", hint: "At start of period", tone: "muted" },
  { key: "received", label: "Received in", hint: "Came into godown", tone: "brand" },
  { key: "consumed", label: "Consumed", hint: "Used on floor", tone: "muted" },
  { key: "returned_to_vendor", label: "Returned to vendor", hint: "Sent back", tone: "warning" },
  { key: "sold", label: "Sold", hint: "Sold to buyer", tone: "brand" },
  {
    key: "adjusted",
    label: "Stock adjustment",
    hint: "Manual correction",
  },
  { key: "closing", label: "Closing stock", hint: "At end of period", tone: "success" },
  { key: "out_at_close", label: "Out on floor", hint: "Issued, not back yet", tone: "warning" },
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
            {periodLabel(from, to)} · every number is weight in kilograms (kg)
          </p>
        </div>
        <Link to="/reports/consumption" className="btn btn-sm">
          Open full report
        </Link>
      </div>
      <div className="dashboard-period-grid">
        {COLUMNS.map((col) => {
          const raw = totals[col.key];
          const display = kgLabel(raw);
          const long = display.length >= 12;
          const tone =
            col.key === "adjusted"
              ? raw < 0
                ? "danger"
                : raw > 0
                  ? "success"
                  : "muted"
              : col.tone;
          const hint =
            col.key === "adjusted"
              ? raw < 0
                ? "Written down (loss)"
                : raw > 0
                  ? "Written up (gain)"
                  : col.hint
              : col.hint;
          return (
            <div
              key={col.key}
              className={[
                "dashboard-period-cell",
                tone ? `dashboard-period-cell--${tone}` : "",
                raw < 0 ? "is-negative" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="dashboard-kpi-label">{col.label}</div>
              <div
                className={`dashboard-period-value${long ? " is-compact" : ""}${raw < 0 ? " is-negative" : ""}`}
                title={display}
              >
                {display}
              </div>
              <div className="dashboard-period-hint">{hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
