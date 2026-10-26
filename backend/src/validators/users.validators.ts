import { z } from "zod";
import { searchSchema } from "./search.validators";

// This panel manages the godown roles only — staff and admin accounts are handled outside
// it, and super_admin is never granted through the API at all (a direct Mongo write only).
// Narrowing the schema itself, not just the frontend's picker, matters because a godown
// supervisor now gets write access to /users too (see users.routes.ts) — without this, a
// supervisor could invite themselves an admin or super_admin account directly.
export const GODOWN_ROLES = ["godown_supervisor", "godown_operator"] as const;
export type GodownRole = (typeof GODOWN_ROLES)[number];

export const inviteUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  role: z.enum(GODOWN_ROLES),
});

/** A password an admin or supervisor sets for someone else. Same floor as the reset flow. */
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(128);

/** Add a user with a password — created active, no invite email. */
export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(GODOWN_ROLES),
  password: passwordSchema,
});

/** Replace a user's password. The old one isn't asked for — this is someone else's account. */
export const setPasswordSchema = z.object({ password: passwordSchema });

export const updateUserSchema = z
  .object({
    role: z.enum(GODOWN_ROLES).optional(),
    status: z.enum(["invited", "active", "suspended"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "Provide role and/or status to update",
  });

/** One page of the user-management list — see search.validators.ts. */
export const searchUsersSchema = searchSchema(["createdAt", "name", "email"]);
