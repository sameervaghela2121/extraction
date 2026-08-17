import type { Request, Response } from "express";
import { rollsService } from "../services/rolls.service";

export const rollsController = {
  async search(req: Request, res: Response) {
    const { query } = req.query as unknown as { query: string };
    const roll = await rollsService.search(query);
    // 200 with null, not 404: "not registered yet" is the expected answer on the Scan
    // screen, not an error the app should treat as a failure.
    res.json({ roll });
  },

  async generateBarcode(_req: Request, res: Response) {
    res.status(201).json(await rollsService.generateBarcode());
  },

  async create(req: Request, res: Response) {
    const roll = await rollsService.create({ ...req.body, registeredBy: req.auth!.userId });
    res.status(201).json(roll);
  },

  async detail(req: Request, res: Response) {
    res.json(await rollsService.detail(req.params.barcodeId));
  },

  async updateStatus(req: Request, res: Response) {
    const { barcodeId } = req.params;
    const userId = req.auth!.userId;
    const body = req.body;

    const result =
      body.status === "OUT"
        ? await rollsService.issue(barcodeId, body.clientId, userId, body.locationId)
        : await rollsService.receiveBack(barcodeId, body.returnedWeightKg, userId, body.locationId);

    res.json(result);
  },

  async history(req: Request, res: Response) {
    res.json({ history: await rollsService.history(req.params.barcodeId) });
  },

  async print(req: Request, res: Response) {
    res.json(await rollsService.printPayload(req.params.barcodeId));
  },
};
