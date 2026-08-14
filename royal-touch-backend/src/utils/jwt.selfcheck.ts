/**
 * `npx tsx src/utils/jwt.selfcheck.ts` — no DB, no server needed.
 *
 * Lives in its own file rather than at the bottom of jwt.ts (the convention the portal
 * uses for fieldKey.ts) because jwt.ts imports config/env, which throws on missing
 * MONGODB_URI at import time. The fake env below has to be set before that import runs.
 */
process.env.MONGODB_URI = "mongodb://selfcheck";
process.env.JWT_ACCESS_SECRET = "access-secret-for-selfcheck";
process.env.JWT_REFRESH_SECRET = "refresh-secret-for-selfcheck";

/* eslint-disable @typescript-eslint/no-var-requires */
const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } =
  require("./jwt") as typeof import("./jwt");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`selfCheck failed: ${msg}`);
}

const payload = { userId: "507f1f77bcf86cd799439011", employeeId: "EMP001", name: "Operator" };

const access = signAccessToken(payload);
const decoded = verifyAccessToken(access);
assert(decoded.userId === payload.userId, "userId survives round-trip");
assert(decoded.employeeId === "EMP001", "employeeId survives round-trip");

const refresh = signRefreshToken({ userId: payload.userId });
assert(verifyRefreshToken(refresh).userId === payload.userId, "refresh round-trip");

// The two secrets must not be interchangeable — a refresh token must never be accepted
// as an access token, which is the whole point of keeping separate secrets.
let crossAccepted = false;
try {
  verifyAccessToken(refresh);
  crossAccepted = true;
} catch {
  /* expected */
}
assert(!crossAccepted, "refresh token rejected by the access verifier");

// The doc requires an expiring access token (that is what /auth/refresh exists for).
const { exp, iat } = verifyAccessToken(access) as unknown as { exp: number; iat: number };
assert(typeof exp === "number" && exp > iat, "access token carries an expiry");

console.log("jwt selfCheck OK");
