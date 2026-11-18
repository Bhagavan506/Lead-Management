import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { leads } from "../db/schema.js";
import type { SessionUser } from "../plugins/auth.js";
import { addActivity, withOwnedLead } from "./lead-work.js";

/** Customer details an employee can enter while on a call. Empty string clears a field. */
export const DETAIL_FIELDS = {
  name: "Name",
  community: "Community",
  flatNumber: "Flat number",
  address: "Address",
  flatType: "Flat type",
  area: "Area",
  requirements: "Requirements",
} as const;
export type DetailField = keyof typeof DETAIL_FIELDS;
export type LeadDetailsInput = Partial<Record<DetailField, string>>;

/**
 * Saves the supplied fields on a lead the employee owns. Only fields whose value really changed are
 * written, and one history entry names them (the new values are kept in its meta). Returns the
 * labels of the fields that changed (empty = nothing to do).
 */
export async function updateLeadDetails(
  db: Db,
  user: Pick<SessionUser, "id" | "role">,
  leadId: string,
  input: LeadDetailsInput,
): Promise<string[]> {
  return withOwnedLead(db, user, leadId, async (tx, lead) => {
    const changed: Partial<Record<DetailField, string>> = {};
    for (const key of Object.keys(DETAIL_FIELDS) as DetailField[]) {
      const next = input[key];
      if (next !== undefined && next !== lead[key]) changed[key] = next;
    }
    const keys = Object.keys(changed) as DetailField[];
    if (keys.length === 0) return [];
    await tx.update(leads).set(changed).where(eq(leads.id, lead.id));
    const labels = keys.map((k) => DETAIL_FIELDS[k]);
    await addActivity(tx, lead.id, user.id, "NOTE", `Details updated: ${labels.join(", ")}`, {
      kind: "DETAILS",
      values: changed,
    });
    return labels;
  });
}
