import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { AppError } from "../errors.js";
import { LOST_REASON_LABEL, STATUS_LABEL, type LostReason, type Status } from "../lib/labels.js";
import type { SessionUser } from "../plugins/auth.js";
import { addActivity, withOwnedLead } from "./lead-work.js";

/**
 * Owner changes the status. Any status can move to any other (as in the prototype).
 *  - Rule 5: Lost needs a reason; leaving Lost clears it (the database also enforces this).
 *  - Won and Lost close the lead, so the follow-up date is cleared.
 * Setting the status it already has is a no-op and writes no history.
 */
export async function changeStatus(
  db: Db,
  user: Pick<SessionUser, "id" | "role">,
  leadId: string,
  status: Status,
  lostReason: LostReason | undefined,
) {
  if (status === "LOST" && !lostReason)
    throw new AppError(422, "LOST_REASON_REQUIRED", "A reason is required to mark a lead as Lost", [
      { path: "lostReason", message: "Required when status is LOST" },
    ]);
  if (status !== "LOST" && lostReason)
    throw new AppError(422, "VALIDATION_ERROR", "Invalid request", [
      { path: "lostReason", message: "Only allowed when status is LOST" },
    ]);

  return withOwnedLead(db, user, leadId, async (tx, lead) => {
    if (lead.status === status && (status !== "LOST" || lead.lostReason === lostReason))
      return { changed: false };

    const closing = status === "WON" || status === "LOST";
    await tx
      .update(leads)
      .set({
        status,
        lostReason: status === "LOST" ? (lostReason as LostReason) : null,
        ...(closing ? { followUpDate: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(leads.id, leadId));

    const text =
      status === "LOST"
        ? `Status: ${STATUS_LABEL[lead.status]} → Lost (${LOST_REASON_LABEL[lostReason as LostReason]})`
        : `Status: ${STATUS_LABEL[lead.status]} → ${STATUS_LABEL[status]}`;
    await addActivity(tx, leadId, user.id, "STATUS_CHANGE", text, {
      from: lead.status,
      to: status,
      ...(status === "LOST" ? { lostReason } : {}),
    });
    return { changed: true };
  });
}
