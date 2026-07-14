import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    });
  }
  return transporter;
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    // Dev fallback: no SMTP configured — log the message so links are still usable.
    logger.info(`[email:dev] To: ${to} | ${subject}\n${html}`);
    return;
  }
  await t.sendMail({ from: env.smtp.from, to, subject, html });
}

export const emailService = {
  async sendInvite(to: string, name: string, acceptUrl: string): Promise<void> {
    await sendMail(
      to,
      "You've been invited to DocFlow",
      `<p>Hi ${name},</p><p>You've been invited to join DocFlow. Click below to set your password and get started:</p><p><a href="${acceptUrl}">Accept invite</a></p><p>This link expires in 7 days.</p>`,
    );
  },

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await sendMail(
      to,
      "Reset your DocFlow password",
      `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you didn't request this, you can ignore this email. This link expires in 1 hour.</p>`,
    );
  },
};
