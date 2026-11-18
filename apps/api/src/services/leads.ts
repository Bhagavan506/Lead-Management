import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads, users } from "../db/schema.js";
import type { SessionUser } from "../plugins/auth.js";
import { leadScope } from "./lead-access.js";
import { notFound } from "../errors.js";
import { getStaleDays } from "./settings.js";

export interface LeadListQuery {
  owner?: string; // user id, or "none" for unassigned
  status?: (typeof leads.$inferSelect)["status"];
  stale?: boolean;
  /** due = open with a follow-up on or before `today`; scheduled = open with any follow-up date. */
  followUp?: "due" | "scheduled";
  search?: string;
  page: number;
  pageSize: number;
}

/** Stale = open AND latest activity older than staleDays (rule 9). */
export function staleExpr(staleDays: number, now: Date) {
  const cutoff = new Date(now.getTime() - staleDays * 86_400_000).toISOString();
  return sql<boolean>`(${leads.status} not in ('WON','LOST') and ${leads.lastActivityAt} < ${cutoff}::timestamptz)`;
}

/** Name is optional: a lead without one is shown by its phone number. */
export const displayName = sql<string>`coalesce(nullif(${leads.name}, ''), ${leads.phone})`;

function leadColumns(isStale: ReturnType<typeof staleExpr>) {
  return {
    id: leads.id,
    name: displayName,
    hasName: sql<boolean>`(${leads.name} <> '')`,
    company: leads.company,
    phone: leads.phone,
    source: leads.source,
    community: leads.community,
    flatNumber: leads.flatNumber,
    address: leads.address,
    flatType: leads.flatType,
    area: leads.area,
    requirements: leads.requirements,
    status: leads.status,
    lostReason: leads.lostReason,
    followUpDate: leads.followUpDate,
    ownerId: leads.ownerId,
    ownerName: users.name,
    lastActivityAt: leads.lastActivityAt,
    lastActivityText: sql<
      string | null
    >`(select a.text from activities a where a.lead_id = ${leads.id} order by a.created_at desc, a.id desc limit 1)`,
    isStale,
    createdAt: leads.createdAt,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function listLeads(
  db: Db,
  user: Pick<SessionUser, "id" | "role">,
  q: LeadListQuery,
  now: Date = new Date(),
  today: string = now.toISOString().slice(0, 10),
) {
  const staleDays = await getStaleDays(db);
  const isStale = staleExpr(staleDays, now);

  const conditions = [leadScope(user)];
  if (q.owner === "none") conditions.push(isNull(leads.ownerId));
  else if (q.owner) conditions.push(eq(leads.ownerId, q.owner));
  if (q.status) conditions.push(eq(leads.status, q.status));
  if (q.stale === true) conditions.push(isStale);
  if (q.stale === false) conditions.push(sql`not ${isStale}`);
  if (q.followUp === "scheduled")
    conditions.push(
      sql`(${leads.status} not in ('WON','LOST') and ${leads.followUpDate} is not null)`,
    );
  if (q.followUp === "due")
    conditions.push(
      sql`(${leads.status} not in ('WON','LOST') and ${leads.followUpDate} <= ${today})`,
    );

  const term = q.search?.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    const digits = term.replace(/\D/g, "");
    conditions.push(
      or(
        ilike(leads.name, like),
        ilike(leads.company, like),
        ilike(leads.community, like),
        ilike(leads.flatNumber, like),
        digits.length >= 3 ? sql`${leads.phone} like ${`%${digits}%`}` : undefined,
      ),
    );
  }
  const where = and(...conditions);

  // Employees see open leads first, soonest follow-up first (as in the prototype); admins see newest first.
  const order =
    user.role === "ADMIN"
      ? sql`${leads.createdAt} desc, ${leads.id}`
      : sql`(${leads.status} in ('WON','LOST')) asc, ${leads.followUpDate} asc nulls last, ${leads.createdAt} desc, ${leads.id}`;

  const [totalRow] = await db.select({ n: count() }).from(leads).where(where);
  const total = totalRow?.n ?? 0;

  const rows = await db
    .select(leadColumns(isStale))
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(where)
    .orderBy(order)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  return {
    leads: rows,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    staleDays,
  };
}

const TIMELINE_LIMIT = 500;

/**
 * One lead with its history. The id AND the role scope are in the same WHERE clause, so a lead
 * that belongs to someone else is indistinguishable from one that does not exist (404 either way).
 */
export async function getLeadDetail(
  db: Db,
  user: Pick<SessionUser, "id" | "role">,
  id: string,
  now: Date = new Date(),
) {
  const staleDays = await getStaleDays(db);
  const [lead] = await db
    .select(leadColumns(staleExpr(staleDays, now)))
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(eq(leads.id, id), leadScope(user)));
  if (!lead) throw notFound("Lead not found");

  const rows = await db
    .select({
      id: activities.id,
      type: activities.type,
      text: activities.text,
      actorId: activities.actorId,
      actorName: users.name,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .innerJoin(users, eq(users.id, activities.actorId))
    .where(eq(activities.leadId, lead.id))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(TIMELINE_LIMIT + 1);

  return {
    lead,
    timeline: rows.slice(0, TIMELINE_LIMIT),
    timelineTruncated: rows.length > TIMELINE_LIMIT,
    staleDays,
  };
}

/** Counts for the signed-in employee's own leads (leadScope keeps it to theirs). */
export async function mySummary(db: Db, user: Pick<SessionUser, "id" | "role">, today: string) {
  const [r] = await db
    .select({
      total: count(),
      notContacted: sql<number>`count(*) filter (where ${leads.status} = 'NEW')`.mapWith(Number),
      followUpsDue:
        sql<number>`count(*) filter (where ${leads.status} not in ('WON','LOST') and ${leads.followUpDate} <= ${today})`.mapWith(
          Number,
        ),
      won: sql<number>`count(*) filter (where ${leads.status} = 'WON')`.mapWith(Number),
    })
    .from(leads)
    .where(leadScope(user));
  return { ...(r as NonNullable<typeof r>), today };
}
