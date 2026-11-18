import { Link } from "react-router-dom";
import type { ConsumptionFigures } from "../../../api/reports.api";
import { kg } from "../format";

const COLUMNS: Array<{ key: keyof ConsumptionFigures; label: string }> = [
  { key: "opening", label: "Opening" },
  { key: "received", label: "Received" },
  { key: "consumed", label: "Consumed" },
  { key: "returned_to_vendor", label: "RTV" },
  { key: "sold", label: "Sold" },
  { key: "adjusted", label: "Adjusted" },
  { key: "closing", label: "Closing" },
  { key: "out_at_close", label: "Out on floor" },
];

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
            {from === to ? from : `${from} to ${to}`} · kg
          </p>
        </div>
        <Link to="/reports/consumption" className="btn btn-sm">
          Open full report
        </Link>
      </div>
      <div className="dashboard-period-grid">
        {COLUMNS.map((col) => (
          <div key={col.key} className="dashboard-period-cell">
            <div className="dashboard-kpi-label">{col.label}</div>
            <div className="dashboard-period-value">{kg(totals[col.key])}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
