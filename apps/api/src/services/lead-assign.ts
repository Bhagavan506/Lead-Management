import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activities, leads } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { lockActiveEmployees } from "./locks.js";

/**
 * Admin assigns, reassigns or (ownerId = null) un-assigns ONE lead (rule 1: one lead, one owner).
 *
 * Runs in one transaction: active employees are locked first (see locks.ts), then the lead row.
 * Concurrent assignments of the same lead are therefore applied one after another, each reading the
 * owner the previous one left, so the history is a connected chain (from -> to -> to ...) and always
 * ends at the real owner. Assigning to the current owner is a no-op and writes no history.
 */
export async function assignLead(
  db: Db,
  admin: { id: string },
  leadId: string,
  ownerId: string | null,
) {
  return db.transaction(async (tx) => {
    const employees = await lockActiveEmployees(tx);

    let ownerName: string | null = null;
    if (ownerId !== null) {
      const target = employees.find((e) => e.id === ownerId);
      if (!target)
        throw new AppError(422, "VALIDATION_ERROR", "Invalid request", [
          { path: "ownerId", message: "Not an active employee" },
        ]);
      ownerName = target.name;
    }

    const [lead] = await tx
      .select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(eq(leads.id, leadId))
      .for("update");
    if (!lead) throw notFound("Lead not found");
    if (lead.ownerId === ownerId) return { changed: false };

    await tx
      .update(leads)
      .set({ ownerId, updatedAt: sql`now()`, lastActivityAt: sql`clock_timestamp()` })
      .where(eq(leads.id, leadId));
    await tx.insert(activities).values({
      leadId,
      actorId: admin.id,
      type: ownerId === null ? "UNASSIGNED" : "ASSIGNED",
      text: ownerId === null ? "Moved back to unassigned pool" : `Assigned to ${ownerName}`,
      meta: { fromOwnerId: lead.ownerId, toOwnerId: ownerId },
      createdAt: sql`clock_timestamp()`,
    });
    return { changed: true };
  });
}
