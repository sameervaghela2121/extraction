import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { count, STATUS_COLORS, STATUS_LABELS } from "../format";

const ORDER = ["IN_STOCK", "ISSUED", "CONSUMED", "RETURNED_TO_VENDOR", "SOLD"];

export default function StatusChart({ byStatus }: { byStatus: Record<string, number> }) {
  const data = ORDER.filter((s) => (byStatus[s] ?? 0) > 0).map((status) => ({
    status,
    name: STATUS_LABELS[status] ?? status,
    value: byStatus[status] ?? 0,
  }));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <h2 className="dashboard-panel-title">Roll status</h2>
        <p className="muted dashboard-panel-sub">{count(total)} live rolls</p>
      </div>
      {total === 0 ? (
        <p className="muted dashboard-empty">No rolls in the register yet.</p>
      ) : (
        <div className="dashboard-status-layout">
          <div className="dashboard-chart dashboard-chart-pie">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={68}
                  outerRadius={100}
                  paddingAngle={2}
                >
                  {data.map((row) => (
                    <Cell key={row.status} fill={STATUS_COLORS[row.status] ?? "#737685"} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${count(Number(value ?? 0))} rolls`, String(name ?? "")]}
                  contentStyle={{ borderRadius: 8, borderColor: "var(--border)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="dashboard-legend">
            {data.map((row) => (
              <li key={row.status}>
                <span
                  className="dashboard-legend-swatch"
                  style={{ background: STATUS_COLORS[row.status] ?? "#737685" }}
                />
                <span>{row.name}</span>
                <strong>{count(row.value)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
