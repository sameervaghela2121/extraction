import { Link } from "react-router-dom";
import type { DashboardTopRow } from "../../../api/dashboard.api";
import { kg } from "../format";

function TopTable({ title, rows, empty }: { title: string; rows: DashboardTopRow[]; empty: string }) {
  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <h2 className="dashboard-panel-title">{title}</h2>
        <Link to="/reports/consumption" className="btn btn-sm btn-ghost">
          Reports
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted dashboard-empty">{empty}</p>
      ) : (
        <table className="table dashboard-table">
          <thead>
            <tr>
              <th>Material</th>
              <th style={{ textAlign: "right" }}>kg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.material_code}-${row.material}`}>
                <td>
                  <div style={{ fontWeight: 600 }}>{row.material || row.material_code || "—"}</div>
                  {row.material_code && (
                    <div className="faint" style={{ fontSize: 12 }}>
                      {row.material_code}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{kg(row.kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function TopTables({
  topConsumed,
  topOutOnFloor,
}: {
  topConsumed: DashboardTopRow[];
  topOutOnFloor: DashboardTopRow[];
}) {
  return (
    <>
      <TopTable title="Top consumed" rows={topConsumed} empty="No consumption in this period." />
      <TopTable
        title="Highest floor exposure"
        rows={topOutOnFloor}
        empty="No rolls out on the floor at period close."
      />
    </>
  );
}
