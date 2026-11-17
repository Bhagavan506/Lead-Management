import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads, users } from "../db/schema.js";
import { LOST_REASON_LABEL } from "../lib/labels.js";
import { dateInTz } from "../lib/dates.js";
import { staleExpr } from "./leads.js";
import { getStaleDays } from "./settings.js";

/** Open = not Won and not Lost. Overdue = open with a follow-up date before today (in APP_TIMEZONE). */
const open = sql`${leads.status} not in ('WON','LOST')`;
const overdue = (today: string) => sql`(${open} and ${leads.followUpDate} < ${today})`;

export async function overviewStats(db: Db, timeZone: string, now = new Date()) {
  const staleDays = await getStaleDays(db);
  const today = dateInTz(timeZone, 0, now);
  const [r] = await db
    .select({
      total: count(),
      unassigned: sql<number>`count(*) filter (where ${isNull(leads.ownerId)})`.mapWith(Number),
      open: sql<number>`count(*) filter (where ${open})`.mapWith(Number),
      won: sql<number>`count(*) filter (where ${leads.status} = 'WON')`.mapWith(Number),
      lost: sql<number>`count(*) filter (where ${leads.status} = 'LOST')`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${overdue(today)})`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${staleExpr(staleDays, now)})`.mapWith(Number),
    })
    .from(leads);
  return { ...(r as NonNullable<typeof r>), staleDays, today };
}

/** One row per ACTIVE employee. Deactivated employees no longer appear (their open leads are back in the pool). */
export async function teamStats(db: Db, timeZone: string, now = new Date()) {
  const today = dateInTz(timeZone, 0, now);
  const rows = await db
    .select({
      employeeId: users.id,
      name: users.name,
      email: users.email,
      assigned: count(leads.id),
      notContacted: sql<number>`count(${leads.id}) filter (where ${leads.status} = 'NEW')`.mapWith(
        Number,
      ),
      worked: sql<number>`count(${leads.id}) filter (where ${leads.status} <> 'NEW')`.mapWith(
        Number,
      ),
      won: sql<number>`count(${leads.id}) filter (where ${leads.status} = 'WON')`.mapWith(Number),
      lost: sql<number>`count(${leads.id}) filter (where ${leads.status} = 'LOST')`.mapWith(Number),
      overdue: sql<number>`count(${leads.id}) filter (where ${overdue(today)})`.mapWith(Number),
    })
    .from(users)
    .leftJoin(leads, eq(leads.ownerId, users.id))
    .where(and(eq(users.role, "EMPLOYEE"), eq(users.isActive, true)))
    .groupBy(users.id)
    .orderBy(users.name, users.id);

  // Last thing each employee did (any lead, as the prototype), separate query to avoid join fan-out.
  const last = await db
    .select({ actorId: activities.actorId, at: max(activities.createdAt) })
    .from(activities)
    .groupBy(activities.actorId);
  const lastBy = new Map(last.map((l) => [l.actorId, l.at]));
  return {
    today,
    employees: rows.map((r) => ({ ...r, lastActivityAt: lastBy.get(r.employeeId) ?? null })),
  };
}

const STALE_LIST_LIMIT = 200;

export async function staleLeads(db: Db, now = new Date()) {
  const staleDays = await getStaleDays(db);
  const isStale = staleExpr(staleDays, now);
  const [t] = await db.select({ n: count() }).from(leads).where(isStale);
  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      company: leads.company,
      status: leads.status,
      ownerId: leads.ownerId,
      ownerName: users.name,
      lastActivityAt: leads.lastActivityAt,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(isStale)
    .orderBy(leads.lastActivityAt, leads.id)
    .limit(STALE_LIST_LIMIT);
  return { staleDays, total: t?.n ?? 0, leads: rows };
}

export async function lostReasons(db: Db) {
  const rows = await db
    .select({ reason: leads.lostReason, n: count() })
    .from(leads)
    .where(eq(leads.status, "LOST"))
    .groupBy(leads.lostReason)
    .orderBy(desc(count()), leads.lostReason);
  return {
    total: rows.reduce((a, r) => a + r.n, 0),
    reasons: rows.map((r) => ({
      reason: r.reason,
      label: r.reason ? LOST_REASON_LABEL[r.reason] : "Not recorded",
      count: r.n,
    })),
  };
}

export async function activityFeed(db: Db, page: number, pageSize: number) {
  const [t] = await db.select({ n: count() }).from(activities);
  const total = t?.n ?? 0;
  const items = await db
    .select({
      id: activities.id,
      type: activities.type,
      text: activities.text,
      createdAt: activities.createdAt,
      actorId: activities.actorId,
      actorName: users.name,
      leadId: activities.leadId,
      leadName: leads.name,
    })
    .from(activities)
    .innerJoin(users, eq(users.id, activities.actorId))
    .innerJoin(leads, eq(leads.id, activities.leadId))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
