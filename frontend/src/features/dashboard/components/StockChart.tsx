import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardStockRow } from "../../../api/dashboard.api";
import { ChartTooltipFrame } from "./ChartTooltip";
import { axisKg, countLabel, kgLabel } from "../format";

export default function StockChart({ rows }: { rows: DashboardStockRow[] }) {
  const data = rows.map((r) => ({
    name: r.material.length > 22 ? `${r.material.slice(0, 20)}…` : r.material,
    fullName: r.material,
    kg: r.on_hand_kg,
    rolls: r.rolls_in_stock,
  }));
  const maxKg = Math.max(...data.map((d) => d.kg), 1);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <h2 className="dashboard-panel-title">Top materials on hand</h2>
        <p className="muted dashboard-panel-sub">In-stock weight right now · kilograms (kg)</p>
      </div>
      {data.length === 0 ? (
        <p className="muted dashboard-empty">No in-stock materials.</p>
      ) : (
        <div className="dashboard-chart">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 64, left: 8, bottom: 0 }}
              barCategoryGap="22%"
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis
                type="number"
                domain={[0, Math.ceil(maxKg * 1.1)]}
                tickFormatter={axisKg}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--brand-soft)", opacity: 0.55 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as
                    | { fullName?: string; kg?: number; rolls?: number }
                    | undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltipFrame
                      active={active}
                      title={row.fullName}
                      rows={[
                        {
                          label: "On hand",
                          value: kgLabel(Number(row.kg ?? 0)),
                          color: "#006e2f",
                        },
                        {
                          label: "Rolls",
                          value: countLabel(Number(row.rolls ?? 0), "rolls"),
                        },
                      ]}
                    />
                  );
                }}
              />
              <Bar
                dataKey="kg"
                fill="#006e2f"
                radius={[0, 6, 6, 0]}
                maxBarSize={data.length === 1 ? 36 : 22}
                background={{ fill: "var(--surface-2)", radius: 6 }}
                isAnimationActive
                animationDuration={550}
              >
                <LabelList
                  dataKey="kg"
                  position="right"
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value);
                    return Number.isFinite(n) ? kgLabel(n) : "";
                  }}
                  className="dashboard-bar-label"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
