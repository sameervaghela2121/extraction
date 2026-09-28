/**
 * Every state a master record (location, vendor, material, remark) can be in — the one
 * list the models and validators both read, so the database and the API can never accept
 * a value the other doesn't. A string enum rather than a boolean so a new state is one
 * more entry here, not a migration.
 */
export const MASTER_STATUSES = ["active", "inactive"] as const;
export type MasterStatus = (typeof MASTER_STATUSES)[number];
