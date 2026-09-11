import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "../models/User.model";
import { ApiError } from "../utils/ApiError";

/** Gate a route to one or more roles. Must run after requireAuth.
 *
 *  super_admin always passes, whatever roles are listed — it is the one role with no
 *  ceiling, and the only one that can never be granted through the app (see USER_ROLES in
 *  User.model.ts). Checked here, once, rather than added to every call site below. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      throw ApiError.unauthorized();
    }
    if (req.auth.role !== "super_admin" && !roles.includes(req.auth.role)) {
      throw ApiError.forbidden("You do not have permission to perform this action");
    }
    next();
  };
}

export const requireAdmin = requireRole("admin");

/** Godown work: maintain the inventory masters and post stock moves. Shared by the
 *  vendors/locations/raw-materials/rolls/stock/sync routes so the list lives in one place. */
export const requireGodownWrite = requireRole(
  "admin",
  "store_manager",
  "godown_supervisor",
  "godown_operator",
);
