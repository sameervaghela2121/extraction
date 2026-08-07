import type { Request, Response } from "express";
import { grnService } from "../services/grn.service";

// Every file this app ever produces is a scanned/uploaded invoice — a PDF or a photo.
// This endpoint has no auth barrier, so a Content-Type it merely forwarded (rather than
// verified) could let an uploaded file get served as text/html and rendered as a page in
// the requester's browser. Anything outside this list is served as a forced download
// instead of whatever the upstream service happened to report.
const SAFE_FILE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function fileUrlFor(req: Request, id: string) {
  return `${req.protocol}://${req.get("host")}/api/public/grn/${id}/file`;
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const publicGrnController = {
  /** GET /api/public/grn?date=YYYY-MM-DD | ?grnStatus=X — every GRN matching the given
   *  filters, full detail each. No filters → every GRN that exists. The main entry point
   *  for external integrations. */
  async list(req: Request, res: Response) {
    const filters = {
      date: queryString(req.query.date),
      grnStatus: queryString(req.query.grnStatus),
    };
    const items = await grnService.publicList(filters, (id) => fileUrlFor(req, id));
    res.json({ items, total: items.length, filters });
  },

  async detail(req: Request, res: Response) {
    res.json(await grnService.publicDetail(req.params.id, fileUrlFor(req, req.params.id)));
  },

  /** PATCH /api/public/grn/:id — { grnStatus: "..." }. Sets the external client's own
   *  status field on that GRN; body already validated by the route's zod schema. */
  async updateGrnStatus(req: Request, res: Response) {
    res.json(await grnService.publicUpdateGrnStatus(req.params.id, req.body.grnStatus));
  },

  async file(req: Request, res: Response) {
    const { stream, contentType } = await grnService.publicFile(req.params.id);
    const safe = SAFE_FILE_CONTENT_TYPES.has(contentType);
    res.setHeader("Content-Type", safe ? contentType : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", safe ? "inline" : `attachment; filename="grn-${req.params.id}"`);
    stream.pipe(res);
  },
};
