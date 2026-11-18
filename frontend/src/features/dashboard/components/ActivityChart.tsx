import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardActivityDay } from "../../../api/dashboard.api";
import { count, shortDate } from "../format";

export default function ActivityChart({ days }: { days: DashboardActivityDay[] }) {
  const data = days.map((d) => ({ ...d, label: shortDate(d.date) }));
  const hasData = data.some((d) => d.count > 0);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2 className="dashboard-panel-title">7-day activity</h2>
          <p className="muted dashboard-panel-sub">
            {hasData ? "Rolls moved per day" : "Quiet week — no roll movements recorded yet"}
          </p>
        </div>
      </div>
      <div className="dashboard-chart">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="dashboardActivityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#003d9b" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#003d9b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
            <YAxis
              allowDecimals={false}
              domain={[0, hasData ? "auto" : 1]}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              width={36}
            />
            <Tooltip
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as { date?: string } | undefined;
                return row?.date ?? "";
              }}
              formatter={(value) => [count(Number(value ?? 0)), "Rolls moved"]}
              contentStyle={{ borderRadius: 8, borderColor: "var(--border)" }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#003d9b"
              strokeWidth={2}
              fill="url(#dashboardActivityFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
