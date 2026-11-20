import type { ReactNode } from "react";

type TooltipRow = {
  label: string;
  value: ReactNode;
  color?: string;
};

/**
 * Shared Recharts tooltip chrome — matches portal cards, readable for large kg figures.
 */
export function ChartTooltipFrame({
  title,
  rows,
  active,
}: {
  title?: ReactNode;
  rows: TooltipRow[];
  active?: boolean;
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="dashboard-chart-tooltip">
      {title != null && title !== "" && <div className="dashboard-chart-tooltip-title">{title}</div>}
      <ul className="dashboard-chart-tooltip-rows">
        {rows.map((row) => (
          <li key={row.label}>
            {row.color && (
              <span className="dashboard-chart-tooltip-swatch" style={{ background: row.color }} />
            )}
            <span className="dashboard-chart-tooltip-label">{row.label}</span>
            <strong className="dashboard-chart-tooltip-value">{row.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
