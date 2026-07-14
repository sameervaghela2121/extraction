import type { UserRole } from "../models/User.model";

export interface AuthPayload {
  userId: string;
  role: UserRole;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export {};
