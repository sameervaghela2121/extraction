import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import { ApiError } from "../utils/ApiError";

type Sources = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

const MAX_LISTED_ISSUES = 3;

/** One readable sentence from a ZodError: the field's own message where the schema gave
 *  it one, prefixed with the field name so the user knows which input to fix. */
export function zodMessage(err: ZodError): string {
  const seen = new Set<string>();
  for (const issue of err.issues) {
    const field = issue.path.join(".");
    // A schema-authored message ("Unit is required") already reads well on its own;
    // Zod's own defaults ("Required") need the field name to mean anything.
    seen.add(field && !issue.message.toLowerCase().includes(field) ? `${field}: ${issue.message}` : issue.message);
    if (seen.size === MAX_LISTED_ISSUES) break;
  }
  const listed = [...seen].join(", ");
  const remaining = err.issues.length - seen.size;
  return remaining > 0 ? `${listed} (and ${remaining} more)` : listed;
}

/** Validates and coerces req.body/query/params against the given Zod schemas. */
export function validate(schemas: Sources) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // The message is shown to the user verbatim (see apiErrorMessage on the client),
        // so it has to name what's wrong — "Validation failed" alone tells them nothing.
        // `details` keeps the full field-by-field breakdown for the caller that wants it.
        throw ApiError.badRequest(zodMessage(err), err.flatten());
      }
      throw err;
    }
  };
}
