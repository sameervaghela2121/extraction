import { z } from "zod";

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

export const updateUserSchema = z
  .object({
    role: z.enum(GODOWN_ROLES).optional(),
    status: z.enum(["invited", "active", "suspended"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "Provide role and/or status to update",
  });
