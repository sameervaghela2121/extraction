import type { Request, Response } from "express";
import { consumptionReportService, type ConsumptionGroup } from "../services/consumptionReport.service";
import { dailyRollReportService } from "../services/dailyRollReport.service";

type ConsumptionQuery = { from: string; to: string; group: ConsumptionGroup };

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

export const reportsController = {
  async dailyRollsCount(req: Request, res: Response) {
    res.json({ count: await dailyRollReportService.count(req.query.date as string) });
  },

  async dailyRolls(req: Request, res: Response) {
    const date = req.query.date as string;
    sendCsv(res, `daily-roll-report-${date}.csv`, await dailyRollReportService.csv(date));
  },

  async consumption(req: Request, res: Response) {
    const { from, to, group } = req.query as unknown as ConsumptionQuery;
    res.json(await consumptionReportService.summary(from, to, group));
  },

  async consumptionCsv(req: Request, res: Response) {
    const { from, to, group } = req.query as unknown as ConsumptionQuery;
    const name = group === "design" ? "consumption-by-design" : "consumption-summary";
    sendCsv(res, `${name}-${from}-to-${to}.csv`, await consumptionReportService.summaryCsv(from, to, group));
  },

  async consumptionDetailCsv(req: Request, res: Response) {
    const { from, to } = req.query as { from: string; to: string };
    sendCsv(res, `consumption-detail-${from}-to-${to}.csv`, await consumptionReportService.detailCsv(from, to));
  },
};
