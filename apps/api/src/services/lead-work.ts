import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads } from "../db/schema.js";
import { notFound } from "../errors.js";
import type { SessionUser } from "../plugins/auth.js";
import { leadScope } from "./lead-access.js";
import type { Tx } from "./locks.js";

export type LeadRow = typeof leads.$inferSelect;

/**
 * Runs `fn` inside a transaction holding a row lock on ONE lead that the user is allowed to see.
 *
 * Id and ownership scope are in the same locked query (never fetch-then-check), so another
 * employee's lead, an unassigned lead and a missing id are all the same 404. If the lead changes
 * hands while we wait for the lock (reassignment, deactivation), the owner test is re-evaluated and
 * the call fails with 404 instead of writing to a lead that is no longer theirs.
 *
 * Callers must additionally use `app.guard("EMPLOYEE")`: admins are read-only on lead work (rule 4).
 */
export async function withOwnedLead<T>(
  db: Db,
  user: Pick<SessionUser, "id" | "role">,
  leadId: string,
  fn: (tx: Tx, lead: LeadRow) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), leadScope(user)))
      .for("update");
    if (!lead) throw notFound("Lead not found");
    return fn(tx, lead);
  });
}

/**
 * Appends one history entry (rule 6) and marks the lead as just worked on. Uses clock_timestamp so
 * entries written one after another in the same transaction keep their order.
 */
export async function addActivity(
  tx: Tx,
  leadId: string,
  actorId: string,
  type: (typeof activities.$inferInsert)["type"],
  text: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(activities).values({
    leadId,
    actorId,
    type,
    text,
    meta: meta ?? null,
    createdAt: sql`clock_timestamp()`,
  });
  await tx
    .update(leads)
    .set({ lastActivityAt: sql`clock_timestamp()`, updatedAt: sql`now()` })
    .where(eq(leads.id, leadId));
}
