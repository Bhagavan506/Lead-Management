import { inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads } from "../db/schema.js";
import { AppError } from "../errors.js";
import type { ParsedCsv, RowIssue } from "../lib/csv-leads.js";
import { distributeLeastLoaded, openLoads } from "./least-loaded.js";
import { lockActiveEmployees } from "./locks.js";

export type UploadMode = { kind: "none" } | { kind: "split" } | { kind: "owner"; ownerId: string };

const CHUNK = 500;
const REPORT_CAP = 500;

const chunks = <T>(items: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Inserts a parsed file in ONE transaction (all or nothing).
 *  - Duplicates against existing leads are decided by the unique phone index
 *    (INSERT ... ON CONFLICT DO NOTHING), not by a check-then-insert, so two uploads running at the
 *    same moment cannot both add the same phone.
 *  - Active employees are locked first (same order as deactivation), so assignment cannot race with
 *    an employee being deactivated.
 *  - "split" gives each new lead to the currently least-loaded active employee (open leads), as in
 *    the prototype.
 */
export async function uploadLeads(
  db: Db,
  admin: { id: string; name: string },
  parsed: ParsedCsv,
  mode: UploadMode,
) {
  return db.transaction(async (tx) => {
    const employees = await lockActiveEmployees(tx);

    if (mode.kind === "owner" && !employees.some((e) => e.id === mode.ownerId))
      throw new AppError(422, "VALIDATION_ERROR", "Invalid request", [
        { path: "ownerId", message: "Not an active employee" },
      ]);
    if (mode.kind === "split" && employees.length === 0)
      throw new AppError(
        409,
        "NO_ACTIVE_EMPLOYEES",
        "There are no active employees to assign leads to",
      );

    // 1. Insert the leads. Rows that hit the unique phone index are returned as "not inserted".
    const idByPhone = new Map<string, string>();
    for (const part of chunks(parsed.valid)) {
      const inserted = await tx
        .insert(leads)
        .values(
          part.map((l) => ({
            name: l.name,
            company: l.company,
            phone: l.phone,
            source: l.source,
            community: l.community,
            flatNumber: l.flatNumber,
            lastActivityAt: sql`clock_timestamp()`,
          })),
        )
        .onConflictDoNothing({ target: leads.phone })
        .returning({ id: leads.id, phone: leads.phone });
      for (const r of inserted) idByPhone.set(r.phone, r.id);
    }
    const added = parsed.valid.filter((l) => idByPhone.has(l.phone));
    const existing: RowIssue[] = parsed.valid
      .filter((l) => !idByPhone.has(l.phone))
      .map((l) => ({
        row: l.row,
        name: l.name,
        phone: l.phone,
        reason: "A lead with this phone number already exists",
      }));

    // 2. History: "Uploaded by ...". clock_timestamp (not now) so later entries sort after earlier ones.
    for (const part of chunks(added)) {
      await tx.insert(activities).values(
        part.map((l) => ({
          leadId: idByPhone.get(l.phone) as string,
          actorId: admin.id,
          type: "UPLOADED" as const,
          text: `Uploaded by ${admin.name}`,
          createdAt: sql`clock_timestamp()`,
        })),
      );
    }

    // 3. Assignment.
    const owners = new Map<string, string[]>(); // employeeId -> lead ids
    if (mode.kind === "owner") {
      owners.set(
        mode.ownerId,
        added.map((l) => idByPhone.get(l.phone) as string),
      );
    } else if (mode.kind === "split" && added.length > 0) {
      const load = await openLoads(tx, employees);
      for (const [ownerId, items] of distributeLeastLoaded(employees, load, added)) {
        owners.set(
          ownerId,
          items.map((l) => idByPhone.get(l.phone) as string),
        );
      }
    }

    const assigned: { ownerId: string; ownerName: string; count: number }[] = [];
    for (const [ownerId, leadIds] of owners) {
      if (leadIds.length === 0) continue;
      const ownerName = (employees.find((e) => e.id === ownerId) as { name: string }).name;
      for (const part of chunks(leadIds)) {
        await tx
          .update(leads)
          .set({ ownerId, updatedAt: sql`now()`, lastActivityAt: sql`clock_timestamp()` })
          .where(inArray(leads.id, part));
        await tx.insert(activities).values(
          part.map((leadId) => ({
            leadId,
            actorId: admin.id,
            type: "ASSIGNED" as const,
            text: `Assigned to ${ownerName}`,
            meta: { toOwnerId: ownerId },
            createdAt: sql`clock_timestamp()`,
          })),
        );
      }
      assigned.push({ ownerId, ownerName, count: leadIds.length });
    }

    const skipped = [...parsed.duplicatesInFile, ...existing].sort((a, b) => a.row - b.row);
    return {
      summary: {
        rows: parsed.valid.length + parsed.invalid.length + parsed.duplicatesInFile.length,
        added: added.length,
        skipped: skipped.length,
        skippedInFile: parsed.duplicatesInFile.length,
        skippedExisting: existing.length,
        invalid: parsed.invalid.length,
      },
      skipped: skipped.slice(0, REPORT_CAP),
      invalid: parsed.invalid.slice(0, REPORT_CAP),
      reportTruncated: skipped.length > REPORT_CAP || parsed.invalid.length > REPORT_CAP,
      assignment: { mode: mode.kind, assigned },
    };
  });
}
