import { useEffect, useState } from "react";
import { apiErrorMessage } from "../../api/client";
import { dashboardApi, type DashboardOverview } from "../../api/dashboard.api";
import { Spinner } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import ActivityChart from "./components/ActivityChart";
import KpiStrip from "./components/KpiStrip";
import MovementChart from "./components/MovementChart";
import PeriodSummary from "./components/PeriodSummary";
import QuickLinks from "./components/QuickLinks";
import StatusChart from "./components/StatusChart";
import StockChart from "./components/StockChart";
import TopTables from "./components/TopTables";
import { iso, rangeOf, type Period } from "./format";

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

/**
 * Inventory operations home: live KPIs, period movement, status and activity charts.
 * Data from royal_touche.api.portal_dashboard.overview — one request per period change.
 */
export default function DashboardPage() {
  const { notify } = useToast();
  const [period, setPeriod] = useState<Period>("day");
  const [picked, setPicked] = useState(() => iso(new Date()));
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const { from, to } = picked ? rangeOf(period, picked) : { from: "", to: "" };

  useEffect(() => {
    if (!from) return;
    let current = true;
    setLoading(true);
    dashboardApi
      .overview(from, to)
      .then((res) => current && setData(res))
      .catch((err) => {
        if (!current) return;
        setData(null);
        notify(apiErrorMessage(err, "Dashboard could not be loaded"), "error");
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [from, to, notify]);

  return (
    <div className="dashboard">
      <header className="dashboard-toolbar card">
        <div className="dashboard-toolbar-copy">
          <h1 className="dashboard-title">Dashboard</h1>
          <p className="muted dashboard-subtitle">
            Live stock and period movement across the godown portal
          </p>
        </div>
        <div className="dashboard-toolbar-controls">
          <div className="dashboard-segment" role="group" aria-label="Period">
            {PERIODS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`dashboard-segment-btn${period === option.key ? " is-active" : ""}`}
                aria-pressed={period === option.key}
                onClick={() => setPeriod(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="dashboard-date-field">
            <label className="field-label" htmlFor="dashboard-date">
              {period === "day" ? "Date" : period === "week" ? "Day in week" : "Day in month"}
            </label>
            <input
              id="dashboard-date"
              className="input"
              type="date"
              max={iso(new Date())}
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
            />
          </div>
        </div>
      </header>

      {loading && !data ? (
        <Spinner label="Loading dashboard" />
      ) : !data ? (
        <div className="card" style={{ padding: 32 }}>
          <p className="muted" style={{ textAlign: "center", margin: 0 }}>
            Dashboard data is unavailable. Try refreshing or pick another period.
          </p>
        </div>
      ) : (
        <div className={`dashboard-body${loading ? " is-loading" : ""}`}>
          <KpiStrip kpis={data.kpis} />
          <PeriodSummary totals={data.period.totals} from={data.period.from} to={data.period.to} />
          <div className="dashboard-charts-grid">
            <MovementChart totals={data.period.totals} />
            <StatusChart byStatus={data.kpis.rolls_by_status} />
            <ActivityChart days={data.activity_7d} />
            <StockChart rows={data.stock_on_hand_top} />
          </div>
          <div className="dashboard-lower-grid">
            <TopTables
              topConsumed={data.period.top_consumed}
              topOutOnFloor={data.period.top_out_on_floor}
            />
            <QuickLinks />
          </div>
        </div>
      )}
    </div>
  );
}
