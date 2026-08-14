import type { Request, Response } from "express";
import { authService } from "../services/auth.service";

export const authController = {
  async login(req: Request, res: Response) {
    const { employeeId, password } = req.body;
    res.json(await authService.login(employeeId, password));
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = req.body;
    res.json(await authService.refresh(refreshToken));
  },

  async logout(_req: Request, res: Response) {
    // Stateless JWT: the app discards both tokens. The doc marks this endpoint
    // "optional, if backend tracks sessions" — it doesn't, so this is a no-op that
    // exists so the client has one URL to call on sign-out.
    res.status(204).send();
  },
};
