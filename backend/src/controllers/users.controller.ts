import type { Request, Response } from "express";
import { usersService } from "../services/users.service";

export const usersController = {
  async list(_req: Request, res: Response) {
    res.json(await usersService.list());
  },

  async invite(req: Request, res: Response) {
    res.status(201).json(await usersService.invite(req.body));
  },

  async update(req: Request, res: Response) {
    res.json(await usersService.update(req.params.id, req.body, req.auth!.userId));
  },

  async remove(req: Request, res: Response) {
    res.json(await usersService.remove(req.params.id, req.auth!.userId));
  },
};
