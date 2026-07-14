import type { NextFunction, Request, Response, RequestHandler } from "express";

/** Wraps an async route handler so thrown/rejected errors reach the Express error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
