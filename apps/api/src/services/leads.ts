import { and, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { leads, users } from "../db/schema.js";
import type { SessionUser } from "../plugins/auth.js";
import { leadScope } from "./lead-access.js";
import { getStaleDays } from "./settings.js";

export interface LeadListQuery {
  owner?: string; // user id, or "none" for unassigned
  status?: (typeof leads.$inferSelect)["status"];
  stale?: boolean;
  search?: string;
  page: number;
  pageSize: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function listLeads(
  db: Db,
  user: Pick<SessionUser, "id" | "role">,
  q: LeadListQuery,
  now: Date = new Date(),
) {
  const staleDays = await getStaleDays(db);
  const cutoff = new Date(now.getTime() - staleDays * 86_400_000).toISOString();
  // Stale = open AND latest activity older than staleDays (rule 9).
  const isStale = sql<boolean>`(${leads.status} not in ('WON','LOST') and ${leads.lastActivityAt} < ${cutoff}::timestamptz)`;

  const conditions = [leadScope(user)];
  if (q.owner === "none") conditions.push(isNull(leads.ownerId));
  else if (q.owner) conditions.push(eq(leads.ownerId, q.owner));
  if (q.status) conditions.push(eq(leads.status, q.status));
  if (q.stale === true) conditions.push(isStale);
  if (q.stale === false) conditions.push(sql`not ${isStale}`);

  const term = q.search?.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    const digits = term.replace(/\D/g, "");
    conditions.push(
      or(
        ilike(leads.name, like),
        ilike(leads.company, like),
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
    .select({
      id: leads.id,
      name: leads.name,
      company: leads.company,
      phone: leads.phone,
      source: leads.source,
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
    })
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
