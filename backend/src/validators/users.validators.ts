import { z } from "zod";

export const inviteUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  role: z.enum(["staff", "admin"]),
});

export const updateUserSchema = z
  .object({
    role: z.enum(["staff", "admin"]).optional(),
    status: z.enum(["invited", "active", "suspended"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "Provide role and/or status to update",
  });
