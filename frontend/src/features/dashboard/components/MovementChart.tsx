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
import { axisKg, kgLabel } from "../format";

const KEYS: Array<{
  key: keyof ConsumptionFigures;
  label: string;
  hint: string;
  color: string;
}> = [
  {
    key: "received",
    label: "Received in",
    hint: "Stock that came into the godown",
    color: "#003d9b",
  },
  {
    key: "consumed",
    label: "Consumed",
    hint: "Used on the floor",
    color: "#6b7280",
  },
  {
    key: "sold",
    label: "Sold",
    hint: "Sold to a buyer",
    color: "#0052cc",
  },
  {
    key: "returned_to_vendor",
    label: "Returned to vendor",
    hint: "Sent back to the supplier",
    color: "#b45309",
  },
  {
    key: "adjusted",
    label: "Stock adjustment",
    hint: "Manual correction — negative means stock was written down",
    color: "#0e7490",
  },
];

const LOSS_COLOR = "#ba1a1a";

export default function MovementChart({ totals }: { totals: ConsumptionFigures }) {
  const data = KEYS.map(({ key, label, hint, color }) => {
    const signed = totals[key];
    const negative = signed < 0;
    return {
      name: label,
      hint,
      signed,
      // Bar length is always positive so losses still draw a visible bar.
      magnitude: Math.abs(signed),
      fill: negative ? LOSS_COLOR : color,
      negative,
    };
  });

  const hasData = data.some((d) => d.magnitude !== 0);
  const maxMag = Math.max(...data.map((d) => d.magnitude), 1);

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2 className="dashboard-panel-title">Movement mix</h2>
          <p className="muted dashboard-panel-sub">
            {hasData
              ? "How stock moved this period · every figure is kilograms (kg)"
              : "No movement yet for this period"}
          </p>
        </div>
      </div>
      <div className="dashboard-chart">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 92, left: 8, bottom: 4 }}
            barCategoryGap="18%"
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
            <XAxis
              type="number"
              domain={hasData ? [0, Math.ceil(maxMag * 1.12)] : [0, 1]}
              tickFormatter={axisKg}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              label={{
                value: "kg",
                position: "insideBottomRight",
                offset: -2,
                style: { fill: "var(--text-muted)", fontSize: 11, fontWeight: 600 },
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={136}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--brand-soft)", opacity: 0.55 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | {
                      name?: string;
                      signed?: number;
                      fill?: string;
                      hint?: string;
                      negative?: boolean;
                    }
                  | undefined;
                if (!row) return null;
                return (
                  <ChartTooltipFrame
                    active={active}
                    title={row.name}
                    rows={[
                      {
                        label: row.negative ? "Written down" : "Total",
                        value: kgLabel(Number(row.signed ?? 0)),
                        color: row.fill,
                      },
                      ...(row.hint ? [{ label: "Meaning", value: row.hint }] : []),
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="magnitude"
              radius={[0, 6, 6, 0]}
              maxBarSize={24}
              background={{ fill: "var(--surface-2)", radius: 6 }}
              isAnimationActive
              animationDuration={550}
            >
              {data.map((row) => (
                <Cell key={row.name} fill={hasData ? row.fill : "var(--rt-outline-variant)"} />
              ))}
              <LabelList
                dataKey="signed"
                position="right"
                formatter={(value) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return Number.isFinite(n) && n !== 0 ? kgLabel(n) : "";
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
