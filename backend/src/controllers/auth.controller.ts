import type { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { env } from "../config/env";

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json(result);
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    res.json(result);
  },

  async logout(_req: Request, res: Response) {
    // Stateless JWT: client discards tokens. Endpoint exists for symmetry / future token denylist.
    res.status(204).send();
  },

  async acceptInvite(req: Request, res: Response) {
    const { token } = req.params;
    const { password } = req.body;
    const result = await authService.acceptInvite(token, password);
    res.json(result);
  },

  async me(req: Request, res: Response) {
    const result = await authService.me(req.auth!.userId);
    res.json(result);
  },

  async forgotPassword(req: Request, res: Response) {
    const { email } = req.body;
    await authService.forgotPassword(email, `${env.frontendOrigin}/reset-password`);
    res.json({ message: "If that email exists, a reset link has been sent." });
  },

  async resetPassword(req: Request, res: Response) {
    const { token, password } = req.body;
    const result = await authService.resetPassword(token, password);
    res.json(result);
  },
};
