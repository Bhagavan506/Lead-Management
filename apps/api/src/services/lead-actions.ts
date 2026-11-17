import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { CALL_OUTCOME_LABEL, STATUS_LABEL, type CallOutcome } from "../lib/labels.js";
import { dateInTz } from "../lib/dates.js";
import type { SessionUser } from "../plugins/auth.js";
import { CLOSED_STATUSES } from "./lead-access.js";
import { addActivity, withOwnedLead } from "./lead-work.js";

type Actor = Pick<SessionUser, "id" | "role">;

/** Rule 8: any call on a New lead moves it to Contacted; No answer / Busy set the follow-up to tomorrow. */
export async function logCall(
  db: Db,
  user: Actor,
  leadId: string,
  outcome: CallOutcome,
  timeZone: string,
) {
  return withOwnedLead(db, user, leadId, async (tx, lead) => {
    await addActivity(tx, lead.id, user.id, "CALL", `Call: ${CALL_OUTCOME_LABEL[outcome]}`, {
      outcome,
    });
    if (lead.status === "NEW") {
      await tx.update(leads).set({ status: "CONTACTED" }).where(eq(leads.id, lead.id));
      await addActivity(
        tx,
        lead.id,
        user.id,
        "STATUS_CHANGE",
        `Status: ${STATUS_LABEL.NEW} → ${STATUS_LABEL.CONTACTED}`,
        {
          from: "NEW",
          to: "CONTACTED",
        },
      );
    }
    // Closed leads (Won/Lost) never carry a follow-up, so the call is logged but no date is set.
    if (
      (outcome === "NO_ANSWER" || outcome === "BUSY") &&
      !(CLOSED_STATUSES as readonly string[]).includes(lead.status)
    ) {
      const date = dateInTz(timeZone, 1);
      await tx.update(leads).set({ followUpDate: date }).where(eq(leads.id, lead.id));
      await addActivity(tx, lead.id, user.id, "FOLLOW_UP", `Follow-up set to ${date}`, { date });
    }
  });
}

export async function addNote(db: Db, user: Actor, leadId: string, text: string) {
  return withOwnedLead(db, user, leadId, (tx, lead) =>
    addActivity(tx, lead.id, user.id, "NOTE", `Note: ${text}`),
  );
}

/** Returns false when nothing changed. Closed leads cannot take a follow-up date. */
export async function setFollowUp(db: Db, user: Actor, leadId: string, date: string | null) {
  return withOwnedLead(db, user, leadId, async (tx, lead) => {
    if (date && (CLOSED_STATUSES as readonly string[]).includes(lead.status))
      return "CLOSED" as const;
    if ((lead.followUpDate ?? null) === date) return "UNCHANGED" as const;
    await tx.update(leads).set({ followUpDate: date }).where(eq(leads.id, lead.id));
    await addActivity(tx, lead.id, user.id, "FOLLOW_UP", `Follow-up set to ${date ?? "none"}`, {
      date,
    });
    return "CHANGED" as const;
  });
}

export async function recordContactEvent(
  db: Db,
  user: Actor,
  leadId: string,
  kind: "CALL" | "WHATSAPP",
) {
  return withOwnedLead(db, user, leadId, (tx, lead) =>
    addActivity(
      tx,
      lead.id,
      user.id,
      "CONTACT_EVENT",
      kind === "CALL" ? "Call started from app" : "WhatsApp chat opened",
      { kind },
    ),
  );
}
