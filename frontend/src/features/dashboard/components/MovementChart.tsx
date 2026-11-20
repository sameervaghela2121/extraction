import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ConsumptionFigures } from "../../../api/reports.api";
import { ChartTooltipFrame } from "./ChartTooltip";
import { axisKg, kg, MOVEMENT_COLORS } from "../format";

const KEYS: Array<{ key: keyof ConsumptionFigures; label: string }> = [
  { key: "received", label: "Received" },
  { key: "consumed", label: "Consumed" },
  { key: "sold", label: "Sold" },
  { key: "returned_to_vendor", label: "Returned to vendor" },
  { key: "adjusted", label: "Adjusted" },
];

export default function MovementChart({ totals }: { totals: ConsumptionFigures }) {
  const data = KEYS.map(({ key, label }) => ({
    name: label,
    kg: totals[key],
    fill: MOVEMENT_COLORS[label] ?? "var(--brand)",
  }));
  const hasData = data.some((d) => d.kg !== 0);
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.kg)), 1);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2 className="dashboard-panel-title">Movement mix</h2>
          <p className="muted dashboard-panel-sub">
            {hasData ? "Period totals (kg)" : "No movement yet — bars stay at zero for this period"}
          </p>
        </div>
      </div>
      <div className="dashboard-chart">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 56, left: 8, bottom: 0 }}
            barCategoryGap="18%"
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
            <XAxis
              type="number"
              domain={hasData ? [0, Math.ceil(maxAbs * 1.08)] : [0, 1]}
              tickFormatter={axisKg}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={128}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--brand-soft)", opacity: 0.55 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | { name?: string; kg?: number; fill?: string }
                  | undefined;
                if (!row) return null;
                return (
                  <ChartTooltipFrame
                    active={active}
                    title={row.name}
                    rows={[
                      {
                        label: "Total",
                        value: `${kg(Number(row.kg ?? 0))} kg`,
                        color: row.fill,
                      },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="kg"
              radius={[0, 6, 6, 0]}
              maxBarSize={24}
              background={{ fill: "var(--surface-2)", radius: 6 }}
              isAnimationActive
              animationDuration={550}
            >
              {data.map((row) => (
                <Cell
                  key={row.name}
                  fill={hasData ? row.fill : "var(--rt-outline-variant)"}
                />
              ))}
              <LabelList
                dataKey="kg"
                position="right"
                formatter={(value) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return !Number.isFinite(n) || n === 0 ? "" : kg(n);
                }}
                className="dashboard-bar-label"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
