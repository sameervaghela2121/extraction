import type { DashboardKpis } from "../../../api/dashboard.api";
import { countLabel, kgLabel } from "../format";

const CARDS: Array<{
  key: string;
  label: string;
  format: (k: DashboardKpis) => string;
  hint?: string;
  tone: "brand" | "success" | "warning" | "neutral" | "info";
  emphasize?: boolean;
}> = [
  {
    key: "rolls_total",
    label: "Live rolls",
    format: (k) => countLabel(k.rolls_total, "rolls"),
    hint: "In the register now",
    tone: "brand",
    emphasize: true,
  },
  {
    key: "on_hand_kg",
    label: "On hand",
    format: (k) => kgLabel(k.on_hand_kg),
    hint: "In-stock weight",
    tone: "success",
    emphasize: true,
  },
  {
    key: "out_on_floor_kg",
    label: "Out on floor",
    format: (k) => kgLabel(k.out_on_floor_kg),
    hint: "Issued weight",
    tone: "warning",
    emphasize: true,
  },
  {
    key: "moved_today",
    label: "Moved today",
    format: (k) => countLabel(k.moved_today, "rolls"),
    hint: "Touched today",
    tone: "info",
    emphasize: true,
  },
  {
    key: "lots_total",
    label: "Lots",
    format: (k) => countLabel(k.lots_total, "lots"),
    tone: "neutral",
  },
  {
    key: "vendors_total",
    label: "Vendors",
    format: (k) => countLabel(k.vendors_total, "vendors"),
    tone: "neutral",
  },
  {
    key: "locations_total",
    label: "Locations",
    format: (k) => countLabel(k.locations_total, "locations"),
    tone: "neutral",
  },
  {
    key: "materials_total",
    label: "Materials",
    format: (k) => countLabel(k.materials_total, "materials"),
    tone: "neutral",
  },
];

export default function KpiStrip({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className="dashboard-kpi-grid">
      {CARDS.map((card) => {
        const value = card.format(kpis);
        const long = value.replace(/\s/g, "").length >= 12;
        return (
          <div
            key={card.key}
            className={[
              "dashboard-kpi",
              "card",
              `dashboard-kpi--${card.tone}`,
              card.emphasize ? "dashboard-kpi--emphasize" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="dashboard-kpi-label">{card.label}</div>
            <div className={`dashboard-kpi-value${long ? " is-compact" : ""}`} title={value}>
              {value}
            </div>
            {card.hint && <div className="dashboard-kpi-hint">{card.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
