import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardStockRow } from "../../../api/dashboard.api";
import { count, kg } from "../format";

export default function StockChart({ rows }: { rows: DashboardStockRow[] }) {
  const data = rows.map((r) => ({
    name: r.material.length > 22 ? `${r.material.slice(0, 20)}…` : r.material,
    fullName: r.material,
    kg: r.on_hand_kg,
    rolls: r.rolls_in_stock,
  }));

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <h2 className="dashboard-panel-title">Top materials on hand</h2>
        <p className="muted dashboard-panel-sub">In-stock kg right now</p>
      </div>
      {data.length === 0 ? (
        <p className="muted dashboard-empty">No in-stock materials.</p>
      ) : (
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              />
              <Tooltip
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { fullName?: string } | undefined;
                  return row?.fullName ?? "";
                }}
                formatter={(value, _name, item) => {
                  const rolls = Number((item?.payload as { rolls?: number } | undefined)?.rolls ?? 0);
                  return [`${kg(Number(value ?? 0))} kg · ${count(rolls)} rolls`, "On hand"];
                }}
                contentStyle={{ borderRadius: 8, borderColor: "var(--border)" }}
              />
              <Bar dataKey="kg" fill="#006e2f" radius={[0, 4, 4, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
