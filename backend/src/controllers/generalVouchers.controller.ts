import type { Request, Response } from "express";
import { generalVouchersService } from "../services/generalVouchers.service";
import { invoiceGeneratorClient } from "../services/invoiceGeneratorClient.service";

export const generalVouchersController = {
  async list(req: Request, res: Response) {
    const { search, status, showArchived, sort, order, page, pageSize } = req.query as Record<
      string,
      string
    >;
    const result = await generalVouchersService.list(req.auth!, {
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
    const result = await generalVouchersService.detail(req.params.id, req.auth!);
    res.json(result);
  },

  async updateFields(req: Request, res: Response) {
    const result = await generalVouchersService.updateFields(
      req.params.id,
      req.body.invoiceId,
      req.body.fields ?? {},
      req.auth!,
    );
    res.json(result);
  },

  async verify(req: Request, res: Response) {
    res.json(await generalVouchersService.transition(req.params.id, req.auth!, "verify"));
  },
  async unverify(req: Request, res: Response) {
    res.json(await generalVouchersService.transition(req.params.id, req.auth!, "unverify"));
  },
  async archive(req: Request, res: Response) {
    res.json(await generalVouchersService.transition(req.params.id, req.auth!, "archive"));
  },
  async restore(req: Request, res: Response) {
    res.json(await generalVouchersService.transition(req.params.id, req.auth!, "restore"));
  },

  async bulkVerify(req: Request, res: Response) {
    res.json(await generalVouchersService.bulkTransition(req.body.ids ?? [], req.auth!, "verify"));
  },
  async bulkUnverify(req: Request, res: Response) {
    res.json(await generalVouchersService.bulkTransition(req.body.ids ?? [], req.auth!, "unverify"));
  },
  async bulkArchive(req: Request, res: Response) {
    res.json(await generalVouchersService.bulkTransition(req.body.ids ?? [], req.auth!, "archive"));
  },

  async activity(req: Request, res: Response) {
    res.json(await generalVouchersService.activity(req.params.id, req.auth!));
  },

  async file(req: Request, res: Response) {
    const voucher = await generalVouchersService.getOwnedOrAdmin(req.params.id, req.auth!);
    const { stream, contentType } = await invoiceGeneratorClient.getRawFile(voucher.fileId.toString());
    res.setHeader("Content-Type", contentType);
    stream.pipe(res);
  },
};
