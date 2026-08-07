import type { Request, Response } from "express";
import { documentsService } from "../services/documents.service";
import { invoiceGeneratorClient } from "../services/invoiceGeneratorClient.service";

// Every file this app ever produces is a scanned/uploaded invoice — a PDF or a photo.
// A Content-Type this route merely forwarded (rather than verified) could let an
// uploaded file get served back as text/html and rendered as a page in the viewer's
// authenticated session. Anything outside this list is forced to download instead.
const SAFE_FILE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

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
    const result = await documentsService.updateFields(
      req.params.id,
      req.body.invoiceId,
      req.body.fields ?? {},
      req.auth!,
    );
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
    const safe = SAFE_FILE_CONTENT_TYPES.has(contentType);
    res.setHeader("Content-Type", safe ? contentType : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", safe ? "inline" : `attachment; filename="document-${req.params.id}"`);
    stream.pipe(res);
  },
};
