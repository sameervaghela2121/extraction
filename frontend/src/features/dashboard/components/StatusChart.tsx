import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltipFrame } from "./ChartTooltip";
import { count, countLabel, pct, STATUS_COLORS, STATUS_LABELS } from "../format";

const ORDER = ["IN_STOCK", "ISSUED", "CONSUMED", "RETURNED_TO_VENDOR", "SOLD"];

export default function StatusChart({ byStatus }: { byStatus: Record<string, number> }) {
  const data = ORDER.filter((s) => (byStatus[s] ?? 0) > 0).map((status) => ({
    status,
    name: STATUS_LABELS[status] ?? status,
    value: byStatus[status] ?? 0,
    color: STATUS_COLORS[status] ?? "#737685",
  }));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <h2 className="dashboard-panel-title">Roll status</h2>
        <p className="muted dashboard-panel-sub">{countLabel(total, "live rolls")}</p>
      </div>
      {total === 0 ? (
        <p className="muted dashboard-empty">No rolls in the register yet.</p>
      ) : (
        <div className="dashboard-status-layout">
          <div className="dashboard-chart dashboard-chart-pie">
            <div className="dashboard-pie-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={104}
                    paddingAngle={2.5}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={600}
                  >
                    {data.map((row) => (
                      <Cell key={row.status} fill={row.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      const row = payload?.[0]?.payload as
                        | { name?: string; value?: number; color?: string }
                        | undefined;
                      if (!row) return null;
                      return (
                        <ChartTooltipFrame
                          active={active}
                          title={row.name}
                          rows={[
                            {
                              label: "Rolls",
                              value: count(Number(row.value ?? 0)),
                              color: row.color,
                            },
                            {
                              label: "Share",
                              value: pct(Number(row.value ?? 0), total),
                            },
                          ]}
                        />
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="dashboard-pie-center" aria-hidden>
                <strong>{count(total)}</strong>
                <span>rolls</span>
              </div>
            </div>
          </div>
          <ul className="dashboard-legend">
            {data.map((row) => (
              <li key={row.status}>
                <span className="dashboard-legend-swatch" style={{ background: row.color }} />
                <span className="dashboard-legend-copy">
                  <span>{row.name}</span>
                  <span className="dashboard-legend-pct">{pct(row.value, total)}</span>
                </span>
                <strong>{count(row.value)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
