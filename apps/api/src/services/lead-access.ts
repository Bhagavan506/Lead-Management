import { eq, type SQL } from "drizzle-orm";
import { leads } from "../db/schema.js";
import type { SessionUser } from "../plugins/auth.js";

/**
 * Rule 3, enforced in the query layer: employees only ever see leads they own. Admins see all.
 *
 * EVERY query that reads or changes a lead must put this in its WHERE clause (list, detail, status,
 * follow-up, calls, notes, contact events). Never rely on hiding things in the UI, and never fetch
 * a lead by id alone and check the owner afterwards. Unassigned leads are invisible to employees.
 */
export function leadScope(user: Pick<SessionUser, "id" | "role">): SQL | undefined {
  return user.role === "ADMIN" ? undefined : eq(leads.ownerId, user.id);
}

export const CLOSED_STATUSES = ["WON", "LOST"] as const;
