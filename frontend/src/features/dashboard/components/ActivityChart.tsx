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
import { ChartTooltipFrame } from "./ChartTooltip";
import { count, shortDate, weekdayShort } from "../format";

export default function ActivityChart({ days }: { days: DashboardActivityDay[] }) {
  const data = days.map((d) => ({
    ...d,
    label: shortDate(d.date),
    weekday: weekdayShort(d.date),
  }));
  const hasData = data.some((d) => d.count > 0);
  const peak = Math.max(...data.map((d) => d.count), 0);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2 className="dashboard-panel-title">7-day activity</h2>
          <p className="muted dashboard-panel-sub">
            {hasData
              ? `${count(total)} rolls moved · peak ${count(peak)} / day`
              : "Quiet week — no roll movements recorded yet"}
          </p>
        </div>
      </div>
      <div className="dashboard-chart">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="dashboardActivityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#003d9b" stopOpacity={0.32} />
                <stop offset="70%" stopColor="#003d9b" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#003d9b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, hasData ? "auto" : 1]}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              width={40}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--brand)", strokeWidth: 1, strokeDasharray: "4 4" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | { date?: string; weekday?: string; count?: number }
                  | undefined;
                if (!row) return null;
                return (
                  <ChartTooltipFrame
                    active={active}
                    title={`${row.weekday ?? ""} · ${row.date ?? ""}`}
                    rows={[
                      {
                        label: "Rolls moved",
                        value: count(Number(row.count ?? 0)),
                        color: "#003d9b",
                      },
                    ]}
                  />
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#003d9b"
              strokeWidth={2.5}
              fill="url(#dashboardActivityFill)"
              dot={{ r: 3, fill: "#003d9b", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#003d9b", stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive
              animationDuration={650}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
