import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import ConsumptionReportPage from "./ConsumptionReportPage";
import DailyRollReportPage from "./DailyRollReportPage";

/** Every report, in the order they are offered. A new report is one more entry here. */
const REPORTS = [
  {
    path: "consumption",
    label: "Consumption",
    description:
      "Stock by material or design, in kg: what was on hand, received, consumed and left. Consumed counts what was actually used, not what was sent out.",
    Report: ConsumptionReportPage,
  },
  {
    path: "daily-rolls",
    label: "Daily roll status",
    description: "One row for each roll that moved on a date, as it stood after its last movement that day.",
    Report: DailyRollReportPage,
  },
];

/** The one place for reports: pick which, and that report's own controls take it from there. */
export default function ReportsPage() {
  const { report } = useParams();
  const navigate = useNavigate();
  const current = REPORTS.find((r) => r.path === report);
  if (!current) return <Navigate to={`/reports/${REPORTS[0].path}`} replace />;

  return (
    <div>
      <PageHeader title="Reports" subtitle={current.description} />
      <div className="row gap-8" role="group" aria-label="Report" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {REPORTS.map((r) => (
          <button
            key={r.path}
            type="button"
            className={`btn ${r.path === current.path ? "btn-primary" : ""}`}
            aria-pressed={r.path === current.path}
            onClick={() => navigate(`/reports/${r.path}`)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <current.Report />
    </div>
  );
}
