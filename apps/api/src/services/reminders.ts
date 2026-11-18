import { and, asc, desc, eq, gt, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { displayName } from "./leads.js";
import { leads, reminderLog, users } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import type { WhatsAppProvider } from "../whatsapp/provider.js";
import { buildReminder } from "./reminder-message.js";

export type RunKind = "SCHEDULED" | "MANUAL";

export interface RunSummary {
  date: string;
  kind: RunKind;
  sent: number;
  failed: number;
  /** A scheduled reminder for this employee and date already exists (rule 10), or a manual one was sent a moment ago. */
  alreadySent: number;
  /** Employees with due follow-ups but no WhatsApp number on file. */
  noPhone: string[];
}

/** A second "Send now" within this window for the same employee is ignored (double-click, retry). */
export const MANUAL_COOLDOWN_SECONDS = 60;

const CLOSED = ["WON", "LOST"] as const;

/** Open leads with a follow-up on or before `today`, per active employee. Only employees' own leads (rule 3). */
export async function dueByEmployee(db: Db, today: string) {
  const rows = await db
    .select({
      employeeId: users.id,
      employeeName: users.name,
      phone: users.phone,
      leadId: leads.id,
      leadName: displayName,
      followUpDate: leads.followUpDate,
    })
    .from(leads)
    .innerJoin(users, eq(users.id, leads.ownerId))
    .where(
      and(
        eq(users.role, "EMPLOYEE"),
        eq(users.isActive, true),
        notInArray(leads.status, [...CLOSED]),
        isNotNull(leads.followUpDate),
        lte(leads.followUpDate, today),
      ),
    )
    .orderBy(asc(leads.followUpDate), asc(leads.name), asc(leads.id));

  const out = new Map<
    string,
    {
      employeeId: string;
      name: string;
      phone: string | null;
      due: { leadId: string; name: string; followUpDate: string }[];
    }
  >();
  for (const r of rows) {
    const e = out.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      name: r.employeeName,
      phone: r.phone,
      due: [],
    };
    e.due.push({ leadId: r.leadId, name: r.leadName, followUpDate: r.followUpDate as string });
    out.set(r.employeeId, e);
  }
  return [...out.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId),
  );
}

/**
 * One reminder run. Safe to call as often as you like and from several processes at once:
 *  - SCHEDULED: the row is claimed first with INSERT ... ON CONFLICT DO NOTHING against the unique
 *    (employee, date) index, and only the process that wins the insert sends (rule 10).
 *  - MANUAL ("Send now"): not limited per day, but not repeated within MANUAL_COOLDOWN_SECONDS.
 * A send that fails is recorded as FAILED and is not retried by the scheduled job (a day's attempt is
 * spent); an admin can use "Send now" to try again.
 */
export async function runReminders(
  db: Db,
  provider: WhatsAppProvider,
  opts: { kind: RunKind; timeZone: string; now?: Date },
): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const today = dateInTz(opts.timeZone, 0, now);
  const summary: RunSummary = {
    date: today,
    kind: opts.kind,
    sent: 0,
    failed: 0,
    alreadySent: 0,
    noPhone: [],
  };

  for (const e of await dueByEmployee(db, today)) {
    if (!e.phone) {
      summary.noPhone.push(e.name);
      continue;
    }
    const { params, text } = buildReminder(e.name, e.due, today);

    // Check-then-claim under a per-employee lock, so two simultaneous "Send now" clicks (or runs on two
    // servers) cannot both pass the cooldown check. The scheduled kind is additionally protected by the
    // unique index. The lock is released at commit, i.e. after the claim row is visible to the other run.
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`reminder:${e.employeeId}`}, 0))`,
      );
      if (opts.kind === "MANUAL") {
        const [recent] = await tx
          .select({ id: reminderLog.id })
          .from(reminderLog)
          .where(
            and(
              eq(reminderLog.employeeId, e.employeeId),
              eq(reminderLog.kind, "MANUAL"),
              gt(
                reminderLog.createdAt,
                sql`now() - (${MANUAL_COOLDOWN_SECONDS} * interval '1 second')`,
              ),
            ),
          )
          .limit(1);
        if (recent) return null;
      }
      const [row] = await tx
        .insert(reminderLog)
        .values({
          employeeId: e.employeeId,
          date: today,
          kind: opts.kind,
          messageText: text,
          provider: provider.name,
          status: "PENDING",
        })
        .onConflictDoNothing()
        .returning({ id: reminderLog.id });
      return row ?? null;
    });
    if (!claimed) {
      summary.alreadySent++;
      continue;
    }

    let result;
    try {
      result = await provider.send({ to: e.phone, params, text });
    } catch (err) {
      result = {
        status: "FAILED" as const,
        providerMessageId: null,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
    await db
      .update(reminderLog)
      .set({ status: result.status, providerMessageId: result.providerMessageId })
      .where(eq(reminderLog.id, claimed.id));
    if (result.status === "SENT") summary.sent++;
    else summary.failed++;
  }
  return summary;
}

export async function reminderLogPage(db: Db, page: number, pageSize: number) {
  const [t] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(reminderLog);
  const total = t?.n ?? 0;
  const items = await db
    .select({
      id: reminderLog.id,
      employeeId: reminderLog.employeeId,
      employeeName: users.name,
      date: reminderLog.date,
      kind: reminderLog.kind,
      messageText: reminderLog.messageText,
      provider: reminderLog.provider,
      status: reminderLog.status,
      createdAt: reminderLog.createdAt,
    })
    .from(reminderLog)
    .innerJoin(users, eq(users.id, reminderLog.employeeId))
    .orderBy(desc(reminderLog.createdAt), desc(reminderLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function recentForEmployee(db: Db, employeeId: string, limit = 3) {
  return db
    .select({
      id: reminderLog.id,
      messageText: reminderLog.messageText,
      status: reminderLog.status,
      createdAt: reminderLog.createdAt,
    })
    .from(reminderLog)
    .where(eq(reminderLog.employeeId, employeeId))
    .orderBy(desc(reminderLog.createdAt), desc(reminderLog.id))
    .limit(limit);
}
