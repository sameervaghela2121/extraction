import { call } from "./client";
import type { ConsumptionFigures } from "./reports.api";

const M = "royal_touche.api.portal_dashboard.";

export interface DashboardKpis {
  rolls_total: number;
  rolls_by_status: Record<string, number>;
  on_hand_kg: number;
  out_on_floor_kg: number;
  lots_total: number;
  vendors_total: number;
  locations_total: number;
  materials_total: number;
  moved_today: number;
}

export interface DashboardTopRow {
  material_code: string;
  material: string;
  kg: number;
}

export interface DashboardStockRow {
  material: string;
  on_hand_kg: number;
  rolls_in_stock: number;
}

export interface DashboardActivityDay {
  date: string;
  count: number;
}

export interface DashboardOverview {
  kpis: DashboardKpis;
  period: {
    from: string;
    to: string;
    totals: ConsumptionFigures;
    top_consumed: DashboardTopRow[];
    top_out_on_floor: DashboardTopRow[];
  };
  stock_on_hand_top: DashboardStockRow[];
  activity_7d: DashboardActivityDay[];
}

export const dashboardApi = {
  overview: (from: string, to: string) =>
    call<DashboardOverview>(`${M}overview`, { from, to }),
};
