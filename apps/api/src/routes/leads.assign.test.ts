import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import { activities, leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createTestApp, loginCookie, type TestApp } from "../test/app.js";

describe.skipIf(!hasDb)("POST /api/leads/:id/assign", () => {
  let ctx: TestApp;
  const cookies: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const lid: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const e of ["admin", "priya", "rohan", "anita"]) {
      cookies[e] = (await loginCookie(ctx.app, `${e}@demo.com`)).cookie;
      uid[e] = (
        (
          await ctx.t.db
            .select()
            .from(users)
            .where(eq(users.email, `${e}@demo.com`))
        )[0] as { id: string }
      ).id;
    }
    for (const l of await ctx.t.db.select().from(leads)) lid[l.name] = l.id;
  });
  afterAll(() => ctx.close());

  const assign = (leadId: string, ownerId: unknown, as: string | null = "admin") =>
    ctx.app.inject({
      method: "POST",
      url: `/api/leads/${leadId}/assign`,
      headers: as ? { cookie: cookies[as] as string } : {},
      payload: { ownerId },
    });
  const view = (as: string, leadId: string) =>
    ctx.app.inject({
      method: "GET",
      url: `/api/leads/${leadId}`,
      headers: { cookie: cookies[as] as string },
    });
  const owner = async (leadId: string) =>
    (await ctx.t.db.select().from(leads).where(eq(leads.id, leadId)))[0]?.ownerId;
  const acts = (leadId: string) =>
    ctx.t.db
      .select()
      .from(activities)
      .where(eq(activities.leadId, leadId))
      .orderBy(asc(activities.createdAt), asc(activities.id));

  it("assigns an unassigned lead; history shows 'Assigned to X' and the owner can now see it", async () => {
    const id = lid["Imran Ali"] as string;
    expect((await view("priya", id)).statusCode).toBe(404); // pool is invisible to employees
    const res = await assign(id, uid.priya);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      changed: true,
      lead: { ownerId: uid.priya, ownerName: "Priya Sharma" },
    });
    const top = res.json().timeline[0]; // newest first
    expect(top).toMatchObject({
      text: "Assigned to Priya Sharma",
      type: "ASSIGNED",
      actorName: "Admin",
    });
    expect((await view("priya", id)).statusCode).toBe(200);
    expect((await view("rohan", id)).statusCode).toBe(404);
  });

  it("reassigns: access moves immediately and the history records from and to", async () => {
    const id = lid["Imran Ali"] as string;
    const res = await assign(id, uid.rohan);
    expect(res.json().timeline[0].text).toBe("Assigned to Rohan Verma");
    expect((await view("priya", id)).statusCode).toBe(404);
    expect((await view("rohan", id)).statusCode).toBe(200);
    const last = (await acts(id)).at(-1);
    expect(last?.meta).toEqual({ fromOwnerId: uid.priya, toOwnerId: uid.rohan });
    expect(last?.actorId).toBe(uid.admin);
  });

  it("moves a lead back to the pool with null", async () => {
    const id = lid["Imran Ali"] as string;
    const res = await assign(id, null);
    expect(res.statusCode).toBe(200);
    expect(res.json().timeline[0]).toMatchObject({
      text: "Moved back to unassigned pool",
      type: "UNASSIGNED",
    });
    expect(await owner(id)).toBeNull();
    expect((await view("rohan", id)).statusCode).toBe(404);
  });

  it("is a no-op when the owner does not change: no history is written", async () => {
    const id = lid["Tara Nair"] as string; // unassigned
    const before = (await acts(id)).length;
    expect((await assign(id, null)).json().changed).toBe(false);
    await assign(id, uid.anita);
    expect((await assign(id, uid.anita)).json().changed).toBe(false);
    expect((await acts(id)).length).toBe(before + 1);
  });

  it("changes nothing but the owner: status, follow-up and reason survive, even on closed leads", async () => {
    const id = lid["Nisha Rao"] as string; // Lost, owned by Anita
    const before = (await ctx.t.db.select().from(leads).where(eq(leads.id, id)))[0];
    expect((await assign(id, uid.rohan)).statusCode).toBe(200);
    const after = (await ctx.t.db.select().from(leads).where(eq(leads.id, id)))[0];
    expect(after).toMatchObject({
      status: "LOST",
      lostReason: "WRONG_CONTACT",
      followUpDate: before?.followUpDate,
      ownerId: uid.rohan,
    });
    expect(after?.lastActivityAt.getTime()).toBeGreaterThan(
      before?.lastActivityAt.getTime() as number,
    );
    await assign(id, uid.anita);
  });

  it("rejects inactive employees, admins, unknown and malformed owners; nothing changes", async () => {
    const id = lid["Vikram Joshi"] as string;
    await ctx.t.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, uid.anita as string));
    const before = (await acts(id)).length;
    for (const body of [
      uid.anita,
      uid.admin,
      "00000000-0000-4000-8000-000000000000",
      "nope",
      5,
      undefined,
    ]) {
      expect((await assign(id, body)).statusCode, String(body)).toBe(422);
    }
    expect(await owner(id)).toBeNull();
    expect((await acts(id)).length).toBe(before);
    await ctx.t.db
      .update(users)
      .set({ isActive: true })
      .where(eq(users.id, uid.anita as string));
  });

  it("returns 404 for an unknown lead and 422 for a malformed id", async () => {
    expect((await assign("00000000-0000-4000-8000-000000000000", uid.priya)).statusCode).toBe(404);
    expect((await assign("not-a-uuid", uid.priya)).statusCode).toBe(422);
  });

  it("is admin-only: an employee cannot assign, not even their own lead", async () => {
    const id = lid["Dev Patel"] as string; // Rohan's
    expect((await assign(id, uid.priya, "rohan")).statusCode).toBe(403);
    expect((await assign(id, uid.priya, "priya")).statusCode).toBe(403);
    expect((await assign(id, uid.priya, null)).statusCode).toBe(401);
    expect(await owner(id)).toBe(uid.rohan);
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, uid.admin as string));
    expect((await assign(id, uid.priya)).statusCode).toBe(403);
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, uid.admin as string));
  });

  it("keeps exactly one owner and a connected history under concurrent assignments (rule 1)", async () => {
    const id = lid["Meera Iyer"] as string;
    const start = await owner(id);
    const targets = [
      "priya",
      "rohan",
      "anita",
      null,
      "priya",
      "anita",
      "rohan",
      null,
      "rohan",
      "priya",
      "anita",
      "rohan",
    ];
    const results = await Promise.all(targets.map((t) => assign(id, t === null ? null : uid[t])));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);

    // The history is a single unbroken chain: every record starts where the previous one ended.
    const chain = (await acts(id))
      .filter((a) => a.type === "ASSIGNED" || a.type === "UNASSIGNED")
      .filter(
        (a) => (a.meta as { toOwnerId?: unknown } | null) && "fromOwnerId" in (a.meta as object),
      );
    const mine = chain.slice(-results.filter((r) => r.json().changed).length);
    let expected = start;
    for (const a of mine) {
      const m = a.meta as { fromOwnerId: string | null; toOwnerId: string | null };
      expect(m.fromOwnerId).toBe(expected);
      expected = m.toOwnerId;
    }
    expect(expected).toBe(await owner(id)); // ...and ends at the real owner
    const owners = await ctx.t.db.select({ o: leads.ownerId }).from(leads).where(eq(leads.id, id));
    expect(owners).toHaveLength(1);
  });

  it("never deadlocks or leaks a lead to a deactivated owner when racing a deactivation", async () => {
    const x = uid.rohan as string;
    const id = lid["Dev Patel"] as string;
    for (let round = 0; round < 8; round++) {
      await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.id, x));
      await ctx.t.db.update(leads).set({ ownerId: null }).where(eq(leads.id, id));
      const [a, d] = await Promise.all([
        assign(id, x),
        ctx.app.inject({
          method: "POST",
          url: `/api/users/${x}/deactivate`,
          headers: { cookie: cookies.admin as string },
        }),
      ]);
      expect(d.statusCode, `round ${round}`).toBe(200);
      expect([200, 422], `round ${round}`).toContain(a.statusCode); // never a 500 / deadlock
      const [lead] = await ctx.t.db.select().from(leads).where(eq(leads.id, id));
      const [rohan] = await ctx.t.db.select().from(users).where(eq(users.id, x));
      expect(rohan?.isActive).toBe(false);
      expect(lead?.ownerId, `round ${round}`).not.toBe(x); // open leads never stay with a deactivated employee
    }
    await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.id, x));
  });

  it("does not deadlock when reassigning a lead away from an employee who is being deactivated", async () => {
    // The dangerous shape: the lead is OWNED by X, X is being deactivated (which must touch the lead),
    // while an admin moves that same lead to Y. Wrong lock order here is a classic deadlock.
    const x = uid.rohan as string;
    const id = lid["Dev Patel"] as string;
    for (let round = 0; round < 10; round++) {
      await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.id, x));
      await ctx.t.db.update(leads).set({ ownerId: x, status: "PROPOSAL" }).where(eq(leads.id, id));
      const [a, d] = await Promise.all([
        assign(id, uid.priya),
        ctx.app.inject({
          method: "POST",
          url: `/api/users/${x}/deactivate`,
          headers: { cookie: cookies.admin as string },
        }),
      ]);
      expect([a.statusCode, d.statusCode], `round ${round}`).toEqual([200, 200]); // a deadlock shows up as 500
      // Either order ends with the lead at Priya: first returned to the pool then assigned, or assigned then nothing to return.
      expect(await owner(id), `round ${round}`).toBe(uid.priya);
    }
    await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.id, x));
  });

  it("counts one ASSIGNED/UNASSIGNED record per real change, never more", async () => {
    const id = lid["Kabir Singh"] as string;
    const n = async () =>
      (
        (
          await ctx.t.db
            .select({ n: count() })
            .from(activities)
            .where(and(eq(activities.leadId, id), eq(activities.type, "ASSIGNED")))
        )[0] as { n: number }
      ).n;
    const before = await n();
    await assign(id, uid.priya);
    await assign(id, uid.priya);
    await assign(id, uid.rohan);
    expect(await n()).toBe(before + 2);
  });
});
