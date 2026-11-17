import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Locks every ACTIVE employee row (ordered by id) and returns them.
 *
 * LOCK ORDER RULE: any transaction that touches both employees and leads must call this FIRST, then
 * lock lead rows. Deactivation, upload, assign and auto-assign all follow it, so they can never
 * deadlock each other, and none can hand a lead to an employee who is being deactivated.
 */
export async function lockActiveEmployees(tx: Tx) {
  return tx
    .select({ id: users.id, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.role, "EMPLOYEE"), eq(users.isActive, true)))
    .orderBy(asc(users.id))
    .for("update");
}
