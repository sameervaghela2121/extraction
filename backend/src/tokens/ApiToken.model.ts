import { Schema, model } from "mongoose";

/**
 * A static key that lets an external system call the public GRN endpoints.
 * Stored as plain text (not hashed) — every request compares it against this
 * value directly, so there's no separate "verify" step that hashing would serve;
 * it's a shared secret between us and the client, not a user password.
 */
export interface IApiToken {
  key: string;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const apiTokenSchema = new Schema<IApiToken>(
  {
    key: { type: String, required: true, unique: true, index: true },
    // Flip to true to cut off a leaked/rotated key without deleting its history.
    isRevoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const ApiToken = model<IApiToken>("ApiToken", apiTokenSchema, "api_tokens");
