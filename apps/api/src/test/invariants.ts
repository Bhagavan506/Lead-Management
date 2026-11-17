import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { expect } from "vitest";
import { activities, leads, users } from "../db/schema.js";
import type { TestApp } from "./app.js";

/**
 * For every lead: its assignment history is ONE connected chain (each record starts where the previous
 * one ended) and ends at the lead's real owner. This is what "one lead, one owner" means in practice:
 * the history can never contradict the current owner, whatever ran concurrently.
 */
export async function expectConsistentOwnership(ctx: TestApp): Promise<void> {
  const all = await ctx.t.db.select().from(leads);
  const records = await ctx.t.db
    .select()
    .from(activities)
    .where(inArray(activities.type, ["ASSIGNED", "UNASSIGNED"]))
    .orderBy(asc(activities.createdAt), asc(activities.id));

  for (const lead of all) {
    const chain = records.filter((r) => r.leadId === lead.id);
    if (chain.length === 0) continue; // never reassigned since it was created
    const meta = (r: (typeof chain)[number]) =>
      r.meta as { fromOwnerId?: string | null; toOwnerId?: string | null };
    let owner = meta(chain[0] as (typeof chain)[number]).fromOwnerId ?? null;
    for (const r of chain) {
      expect(meta(r).fromOwnerId ?? null, `lead ${lead.name}: broken chain`).toBe(owner);
      owner = meta(r).toOwnerId ?? null;
    }
    expect(owner, `lead ${lead.name}: history ends somewhere other than its owner`).toBe(
      lead.ownerId,
    );
  }
}

/** No open (not Won/Lost) lead may belong to a deactivated employee. */
export async function expectNoOpenLeadsWithInactiveOwners(ctx: TestApp): Promise<void> {
  const inactive = (await ctx.t.db.select().from(users).where(eq(users.isActive, false))).map(
    (u) => u.id,
  );
  if (inactive.length === 0) return;
  const bad = await ctx.t.db
    .select()
    .from(leads)
    .where(and(inArray(leads.ownerId, inactive), notInArray(leads.status, ["WON", "LOST"])));
  expect(bad.map((l) => l.name)).toEqual([]);
}
