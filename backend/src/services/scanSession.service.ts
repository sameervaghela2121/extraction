import crypto from "crypto";
import { ScanSession } from "../models/ScanSession.model";
import { invoiceGeneratorClient } from "./invoiceGeneratorClient.service";
import { documentsService } from "./documents.service";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import type { AuthPayload } from "../types/express";

const SESSION_TTL_MS = 10 * 60 * 1000;

export const scanSessionService = {
  async create(auth: AuthPayload) {
    const token = crypto.randomBytes(16).toString("hex");
    const session = await ScanSession.create({
      token,
      userId: auth.userId,
      status: "pending",
      pages: [],
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      scanUrl: `${env.frontendOrigin}/scan/${session.token}`,
    };
  },

  async getState(token: string) {
    const session = await ScanSession.findOne({ token });
    if (!session) throw ApiError.notFound("Scan session not found");
    if (session.expiresAt < new Date() && session.status !== "uploaded") {
      session.status = "expired";
      await session.save();
    }
    return {
      token: session.token,
      status: session.status,
      pageCount: session.pages.length,
      expiresAt: session.expiresAt,
      resultDocumentId: session.resultDocumentId?.toString(),
    };
  },

  async addPage(token: string, page: { buffer: Buffer; originalname: string; mimetype: string }) {
    const session = await ScanSession.findOne({ token });
    if (!session) throw ApiError.notFound("Scan session not found");
    if (session.expiresAt < new Date()) throw ApiError.badRequest("This scan session has expired");
    if (session.status === "uploaded") throw ApiError.badRequest("This session is already complete");

    session.pages.push({ filename: page.originalname, data: page.buffer, mime: page.mimetype });
    session.status = "capturing";
    await session.save();
    return { pageCount: session.pages.length };
  },

  async complete(token: string) {
    const session = await ScanSession.findOne({ token });
    if (!session) throw ApiError.notFound("Scan session not found");
    if (session.pages.length === 0) throw ApiError.badRequest("No pages captured yet");

    const files = session.pages.map((p, i) => ({
      buffer: p.data,
      originalname: p.filename || `scan-page-${i + 1}`,
      mimetype: p.mime,
    }));

    const { jobId } = await invoiceGeneratorClient.extract(files);
    const [doc] = await documentsService.createFromExtraction(
      jobId,
      session.userId.toString(),
      "scan",
      files.length,
    );

    session.status = "uploaded";
    session.resultDocumentId = doc._id;
    await session.save();
    return { documentId: doc._id.toString() };
  },
};
