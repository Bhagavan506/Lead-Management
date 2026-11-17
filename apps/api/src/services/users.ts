import argon2 from "argon2";
import { and, asc, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads, users } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { lockActiveEmployees } from "./locks.js";
import { generateTempPassword } from "../lib/password.js";

const CLOSED = ["WON", "LOST"] as const;

const publicColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  phone: users.phone,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
};

export async function listUsers(db: Db) {
  const rows = await db
    .select(publicColumns)
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.name));
  const open = await db
    .select({ ownerId: leads.ownerId, n: count() })
    .from(leads)
    .where(and(notInArray(leads.status, [...CLOSED]), sql`${leads.ownerId} is not null`))
    .groupBy(leads.ownerId);
  const byOwner = new Map(open.map((o) => [o.ownerId, o.n]));
  return rows.map((u) => ({ ...u, openLeads: byOwner.get(u.id) ?? 0 }));
}

export async function createEmployee(
  db: Db,
  input: { name: string; email: string; phone: string },
) {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await argon2.hash(temporaryPassword);
  try {
    const [row] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone,
        role: "EMPLOYEE",
        passwordHash,
        mustChangePassword: true,
      })
      .returning(publicColumns);
    return { user: { ...(row as object), openLeads: 0 }, temporaryPassword };
  } catch (e) {
    // 23505 = unique_violation (users_email_lower_key)
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505")
      throw new AppError(409, "EMAIL_TAKEN", "A user with this email already exists");
    throw e;
  }
}

/**
 * Rule 7, all in one transaction:
 *  - the last active employee cannot be deactivated (all active employee rows are locked first,
 *    so two concurrent deactivations cannot both pass the check);
 *  - every OPEN lead (not Won/Lost) of the employee returns to the unassigned pool, with an
 *    activity record each; closed leads keep their owner and history;
 *  - the account is switched off, which blocks login and any existing session.
 */
export async function deactivateEmployee(db: Db, targetId: string, adminId: string) {
  return db.transaction(async (tx) => {
    const active = await lockActiveEmployees(tx);

    const [target] = await tx
      .select(publicColumns)
      .from(users)
      .where(eq(users.id, targetId))
      .for("update");
    if (!target) throw notFound("User not found");
    if (target.role !== "EMPLOYEE")
      throw new AppError(409, "NOT_AN_EMPLOYEE", "Only employees can be deactivated");
    if (!target.isActive) return { user: target, leadsReturned: 0 };
    if (active.length <= 1)
      throw new AppError(409, "LAST_ACTIVE_EMPLOYEE", "At least one active employee must remain");

    const open = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.ownerId, targetId), notInArray(leads.status, [...CLOSED])))
      .for("update");

    if (open.length > 0) {
      const ids = open.map((l) => l.id);
      await tx
        .update(leads)
        .set({ ownerId: null, updatedAt: sql`now()`, lastActivityAt: sql`clock_timestamp()` })
        .where(inArray(leads.id, ids));
      await tx.insert(activities).values(
        ids.map((leadId) => ({
          leadId,
          actorId: adminId,
          type: "UNASSIGNED" as const,
          text: "Moved back to unassigned pool",
          meta: { fromOwnerId: targetId, reason: "employee_deactivated" },
          // clock_timestamp, not now(): now() is the transaction START, which would sort this entry
          // before an assignment that committed first while we waited on its lock.
          createdAt: sql`clock_timestamp()`,
        })),
      );
    }

    await tx.update(users).set({ isActive: false }).where(eq(users.id, targetId));
    return { user: { ...target, isActive: false }, leadsReturned: open.length };
  });
}

export async function reactivateEmployee(db: Db, targetId: string) {
  const [target] = await db.select(publicColumns).from(users).where(eq(users.id, targetId));
  if (!target) throw notFound("User not found");
  if (target.role !== "EMPLOYEE")
    throw new AppError(409, "NOT_AN_EMPLOYEE", "Only employees can be reactivated");
  if (!target.isActive)
    await db.update(users).set({ isActive: true }).where(eq(users.id, targetId));
  return { user: { ...target, isActive: true } };
}
