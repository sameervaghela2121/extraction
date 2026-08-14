import { z } from "zod";

export const loginSchema = z.object({
  employeeId: z.string().min(1),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
