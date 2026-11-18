import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ConsumptionFigures } from "../../../api/reports.api";
import { kg, MOVEMENT_COLORS } from "../format";

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
  }));
  const hasData = data.some((d) => d.kg !== 0);

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
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
            <XAxis
              type="number"
              domain={[0, hasData ? "auto" : 1]}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={128}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            />
            <Tooltip
              formatter={(value) => [`${kg(Number(value ?? 0))} kg`, ""]}
              contentStyle={{ borderRadius: 8, borderColor: "var(--border)" }}
            />
            <Bar dataKey="kg" radius={[0, 4, 4, 0]} maxBarSize={22} background={{ fill: "var(--surface-2)" }}>
              {data.map((row) => (
                <Cell
                  key={row.name}
                  fill={hasData ? (MOVEMENT_COLORS[row.name] ?? "var(--brand)") : "var(--rt-outline-variant)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
