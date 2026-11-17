import { and, asc, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads } from "../db/schema.js";
import { AppError } from "../errors.js";
import { distributeLeastLoaded, openLoads } from "./least-loaded.js";
import { lockActiveEmployees } from "./locks.js";

const CHUNK = 500;

/**
 * Gives every unassigned OPEN lead (not Won/Lost) to the currently least-loaded active employee,
 * one by one, in a single transaction.
 *
 * Active employees are locked first (see locks.ts), so two auto-assigns, or one racing an upload,
 * an assign or a deactivation, run one after another: each reads the loads the previous one left, no
 * lead is picked up twice, and no lead goes to an employee who is being deactivated.
 */
export async function autoAssignLeads(db: Db, admin: { id: string }) {
  return db.transaction(async (tx) => {
    const employees = await lockActiveEmployees(tx);
    if (employees.length === 0)
      throw new AppError(
        409,
        "NO_ACTIVE_EMPLOYEES",
        "There are no active employees to assign leads to",
      );

    const pool = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(isNull(leads.ownerId), notInArray(leads.status, ["WON", "LOST"])))
      .orderBy(asc(leads.createdAt), asc(leads.id))
      .for("update");
    if (pool.length === 0) return { assigned: 0, byEmployee: [] };

    const plan = distributeLeastLoaded(employees, await openLoads(tx, employees), pool);
    const byEmployee: { ownerId: string; ownerName: string; count: number }[] = [];

    for (const [ownerId, items] of plan) {
      const ownerName = (employees.find((e) => e.id === ownerId) as { name: string }).name;
      for (let i = 0; i < items.length; i += CHUNK) {
        const ids = items.slice(i, i + CHUNK).map((l) => l.id);
        await tx
          .update(leads)
          .set({ ownerId, updatedAt: sql`now()`, lastActivityAt: sql`clock_timestamp()` })
          .where(inArray(leads.id, ids));
        await tx.insert(activities).values(
          ids.map((leadId) => ({
            leadId,
            actorId: admin.id,
            type: "ASSIGNED" as const,
            text: `Assigned to ${ownerName}`,
            meta: { fromOwnerId: null, toOwnerId: ownerId, auto: true },
            createdAt: sql`clock_timestamp()`,
          })),
        );
      }
      byEmployee.push({ ownerId, ownerName, count: items.length });
    }
    return { assigned: pool.length, byEmployee };
  });
}
