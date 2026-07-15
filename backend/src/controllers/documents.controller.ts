import type { Request, Response } from "express";
import { documentsService } from "../services/documents.service";
import { invoiceGeneratorClient } from "../services/invoiceGeneratorClient.service";

export const documentsController = {
  async list(req: Request, res: Response) {
    const { search, status, showArchived, sort, order, page, pageSize } = req.query as Record<
      string,
      string
    >;
    const result = await documentsService.list(req.auth!, {
      search,
      status,
      showArchived: showArchived === "true",
      sort,
      order: order === "asc" ? "asc" : "desc",
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  },

  async detail(req: Request, res: Response) {
    const result = await documentsService.detail(req.params.id, req.auth!);
    res.json(result);
  },

  async updateFields(req: Request, res: Response) {
    const result = await documentsService.updateFields(req.params.id, req.body.fields ?? {}, req.auth!);
    res.json(result);
  },

  async verify(req: Request, res: Response) {
    res.json(await documentsService.transition(req.params.id, req.auth!, "verify"));
  },
  async unverify(req: Request, res: Response) {
    res.json(await documentsService.transition(req.params.id, req.auth!, "unverify"));
  },
  async archive(req: Request, res: Response) {
    res.json(await documentsService.transition(req.params.id, req.auth!, "archive"));
  },
  async restore(req: Request, res: Response) {
    res.json(await documentsService.transition(req.params.id, req.auth!, "restore"));
  },

  async bulkVerify(req: Request, res: Response) {
    res.json(await documentsService.bulkTransition(req.body.ids ?? [], req.auth!, "verify"));
  },
  async bulkUnverify(req: Request, res: Response) {
    res.json(await documentsService.bulkTransition(req.body.ids ?? [], req.auth!, "unverify"));
  },
  async bulkArchive(req: Request, res: Response) {
    res.json(await documentsService.bulkTransition(req.body.ids ?? [], req.auth!, "archive"));
  },

  async activity(req: Request, res: Response) {
    res.json(await documentsService.activity(req.params.id, req.auth!));
  },

  async file(req: Request, res: Response) {
    // Authorize via the same ownership check, then proxy the raw bytes from the extraction service.
    const doc = await documentsService.getOwnedOrAdmin(req.params.id, req.auth!);
    const { stream, contentType } = await invoiceGeneratorClient.getRawFile(doc.fileId.toString());
    res.setHeader("Content-Type", contentType);
    stream.pipe(res);
  },
};
