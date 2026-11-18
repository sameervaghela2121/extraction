import type { DashboardKpis } from "../../../api/dashboard.api";
import { count, kg } from "../format";

const CARDS: Array<{
  key: string;
  label: string;
  format: (k: DashboardKpis) => string;
  hint?: string;
  tone: "brand" | "success" | "warning" | "neutral" | "info";
}> = [
  { key: "rolls_total", label: "Live rolls", format: (k) => count(k.rolls_total), tone: "brand" },
  {
    key: "on_hand_kg",
    label: "On hand",
    format: (k) => `${kg(k.on_hand_kg)} kg`,
    hint: "In stock",
    tone: "success",
  },
  {
    key: "out_on_floor_kg",
    label: "Out on floor",
    format: (k) => `${kg(k.out_on_floor_kg)} kg`,
    hint: "Issued",
    tone: "warning",
  },
  {
    key: "moved_today",
    label: "Moved today",
    format: (k) => count(k.moved_today),
    hint: "Rolls",
    tone: "info",
  },
  { key: "lots_total", label: "Lots", format: (k) => count(k.lots_total), tone: "neutral" },
  { key: "vendors_total", label: "Vendors", format: (k) => count(k.vendors_total), tone: "neutral" },
  {
    key: "locations_total",
    label: "Locations",
    format: (k) => count(k.locations_total),
    tone: "neutral",
  },
  {
    key: "materials_total",
    label: "Materials",
    format: (k) => count(k.materials_total),
    tone: "neutral",
  },
];

export default function KpiStrip({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className="dashboard-kpi-grid">
      {CARDS.map((card) => (
        <div key={card.key} className={`dashboard-kpi card dashboard-kpi--${card.tone}`}>
          <div className="dashboard-kpi-label">{card.label}</div>
          <div className="dashboard-kpi-value">{card.format(kpis)}</div>
          {card.hint && <div className="dashboard-kpi-hint">{card.hint}</div>}
        </div>
      ))}
    </div>
  );
}
