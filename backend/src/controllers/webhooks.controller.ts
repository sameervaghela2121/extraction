import type { Request, Response } from "express";
import { invoiceGeneratorClient, type UploadedFile } from "../services/invoiceGeneratorClient.service";
import { documentsService } from "../services/documents.service";
import { User } from "../models/User.model";
import { logger } from "../utils/logger";

/**
 * Inbound-email webhook. Provider-agnostic: expects the parsed attachment(s) as multipart `files`
 * and the recipient address as `to` (e.g. documents+ab12cd34@scan.docflow.app). The alias suffix
 * maps back to the owning user's id tail. If it can't be resolved, the document is assigned to an admin.
 *
 * NOTE: the concrete provider (SendGrid Inbound Parse / Mailgun Routes) is not yet chosen — this is
 * the integration seam. Secure it with a provider signature check before exposing publicly.
 */
export const webhooksController = {
  async inboundEmail(req: Request, res: Response) {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      logger.warn("[webhook:inbound-email] no attachments; ignoring");
      res.status(200).json({ ignored: true });
      return;
    }

    const to = String(req.body.to ?? "");
    const aliasMatch = to.match(/\+([a-f0-9]{8})@/i);
    let owner = null;
    if (aliasMatch) {
      const alias = aliasMatch[1];
      const candidates = await User.find({ status: "active" }).select("_id");
      owner = candidates.find((u) => u._id.toString().endsWith(alias)) ?? null;
    }
    if (!owner) {
      owner = await User.findOne({ role: "admin", status: "active" }).select("_id");
    }
    if (!owner) {
      logger.warn("[webhook:inbound-email] no owner resolvable; dropping");
      res.status(200).json({ ignored: true });
      return;
    }

    const uploaded: UploadedFile[] = files.map((f) => ({
      buffer: f.buffer,
      originalname: f.originalname,
      mimetype: f.mimetype,
    }));
    const { jobId } = await invoiceGeneratorClient.extract(uploaded);
    await documentsService.createFromExtraction(jobId, owner._id.toString(), "email", uploaded.length);

    res.status(200).json({ ok: true });
  },
};
