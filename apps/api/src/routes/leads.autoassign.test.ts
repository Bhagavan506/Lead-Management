import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, isNull, notInArray, sql } from "drizzle-orm";
import { activities, leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createTestApp, loginCookie, type TestApp } from "../test/app.js";
import {
  expectConsistentOwnership,
  expectNoOpenLeadsWithInactiveOwners,
} from "../test/invariants.js";

describe.skipIf(!hasDb)("POST /api/leads/auto-assign", () => {
  let ctx: TestApp;
  const cookies: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let seq = 0;

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
  });
  afterAll(() => ctx.close());

  // Start every test from the seed's pool (3 unassigned leads) plus nothing extra.
  beforeEach(async () => {
    await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.role, "EMPLOYEE"));
  });

  const autoAssign = (as: string | null = "admin") =>
    ctx.app.inject({
      method: "POST",
      url: "/api/leads/auto-assign",
      headers: as ? { cookie: cookies[as] as string } : {},
    });
  const addPool = async (n: number, status: "NEW" | "WON" = "NEW") => {
    const rows = Array.from({ length: n }, () => {
      const i = seq++;
      return {
        name: `Pool ${i}`,
        phone: `+9199${String(i).padStart(8, "0")}`,
        status,
        lostReason: null,
      } as const;
    });
    await ctx.t.db.insert(leads).values(rows.map((r) => ({ ...r })));
  };
  const open = (e: string) =>
    ctx.t.db
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.ownerId, uid[e] as string), notInArray(leads.status, ["WON", "LOST"])))
      .then((r) => (r[0] as { n: number }).n);
  const loads = async () => ({
    priya: await open("priya"),
    rohan: await open("rohan"),
    anita: await open("anita"),
  });
  const poolSize = async () =>
    (
      await ctx.t.db
        .select({ n: count() })
        .from(leads)
        .where(and(isNull(leads.ownerId), notInArray(leads.status, ["WON", "LOST"])))
    )[0]?.n;

  it("gives each unassigned lead to the least-loaded employee, not counting closed leads as load", async () => {
    // seed: Priya 2 open, Rohan 2 open, Anita 0 open (her 2 leads are Won/Lost) and 3 leads in the pool
    const res = await autoAssign();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.assigned).toBe(3);
    const counts = Object.fromEntries(
      body.byEmployee.map((b: { ownerName: string; count: number }) => [b.ownerName, b.count]),
    );
    // Anita starts emptiest, so she fills up first and gets at least 2. Once everyone is level at 2,
    // the last lead goes to whoever wins the tie (account age, then id), so she may get a third.
    expect(counts["Anita Das"]).toBeGreaterThanOrEqual(2);
    const after = await loads();
    expect(after.anita).toBeGreaterThanOrEqual(2);
    expect(after.priya + after.rohan + after.anita).toBe(2 + 2 + 3); // 7 open leads in total
    expect(
      Math.max(...Object.values(after)) - Math.min(...Object.values(after)),
    ).toBeLessThanOrEqual(1);
    expect(await poolSize()).toBe(0);
  });

  it("writes one 'Assigned to X' history entry per lead, and only the new owner can see it", async () => {
    await addPool(4);
    const res = await autoAssign();
    expect(res.json().assigned).toBe(4);
    const rows = await ctx.t.db
      .select()
      .from(leads)
      .where(sql`${leads.name} like 'Pool %'`);
    for (const lead of rows) {
      const hist = await ctx.t.db.select().from(activities).where(eq(activities.leadId, lead.id));
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ type: "ASSIGNED", actorId: uid.admin });
      expect(hist[0]?.text).toMatch(/^Assigned to (Priya Sharma|Rohan Verma|Anita Das)$/);
      expect(hist[0]?.meta).toMatchObject({
        fromOwnerId: null,
        toOwnerId: lead.ownerId,
        auto: true,
      });
      const owner = ["priya", "rohan", "anita"].find((e) => uid[e] === lead.ownerId) as string;
      const other = ["priya", "rohan", "anita"].find((e) => e !== owner) as string;
      const url = `/api/leads/${lead.id}`;
      expect(
        (
          await ctx.app.inject({
            method: "GET",
            url,
            headers: { cookie: cookies[owner] as string },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await ctx.app.inject({
            method: "GET",
            url,
            headers: { cookie: cookies[other] as string },
          })
        ).statusCode,
      ).toBe(404);
    }
  });

  it("is idempotent: with nothing in the pool it assigns nothing and writes no history", async () => {
    await autoAssign();
    const before = (await ctx.t.db.select({ n: count() }).from(activities))[0]?.n;
    const res = await autoAssign();
    expect(res.json()).toEqual({ assigned: 0, byEmployee: [] });
    expect((await ctx.t.db.select({ n: count() }).from(activities))[0]?.n).toBe(before);
  });

  it("keeps the team balanced (within one lead of each other) for a large pool", async () => {
    await addPool(47);
    await autoAssign();
    const l = Object.values(await loads());
    expect(Math.max(...l) - Math.min(...l)).toBeLessThanOrEqual(1);
  });

  it("never gives leads to a deactivated employee", async () => {
    await ctx.t.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, uid.anita as string));
    const anitaBefore = await ctx.t.db
      .select({ n: count() })
      .from(leads)
      .where(eq(leads.ownerId, uid.anita as string));
    await addPool(6);
    const res = await autoAssign();
    expect(res.json().byEmployee.map((b: { ownerId: string }) => b.ownerId)).not.toContain(
      uid.anita,
    );
    expect(
      (
        await ctx.t.db
          .select({ n: count() })
          .from(leads)
          .where(eq(leads.ownerId, uid.anita as string))
      )[0]?.n,
    ).toBe(anitaBefore[0]?.n);
  });

  it("returns 409 and changes nothing when there is nobody to assign to", async () => {
    await addPool(2);
    await ctx.t.db.update(users).set({ isActive: false }).where(eq(users.role, "EMPLOYEE"));
    const pool = await poolSize();
    const res = await autoAssign();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_ACTIVE_EMPLOYEES");
    expect(await poolSize()).toBe(pool);
  });

  it("leaves unassigned Won/Lost leads alone", async () => {
    await addPool(2, "WON");
    const openPool = (await poolSize()) as number;
    const res = await autoAssign();
    expect(res.json().assigned).toBe(openPool); // exactly the open ones
    const closed = await ctx.t.db
      .select()
      .from(leads)
      .where(and(isNull(leads.ownerId), eq(leads.status, "WON")));
    expect(closed).toHaveLength(2);
    expect(await poolSize()).toBe(0);
  });

  it("is admin-only", async () => {
    await addPool(2);
    const pool = await poolSize();
    expect((await autoAssign("priya")).statusCode).toBe(403);
    expect((await autoAssign(null)).statusCode).toBe(401);
    expect(await poolSize()).toBe(pool);
  });

  describe("concurrency (rule 1: one lead, one owner)", () => {
    it("three simultaneous auto-assigns give every lead exactly one owner and one history entry", async () => {
      await autoAssign(); // clear the pool first
      await addPool(30);
      const results = await Promise.all([autoAssign(), autoAssign(), autoAssign()]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(results.reduce((n, r) => n + r.json().assigned, 0)).toBe(30); // nobody was handled twice
      expect(await poolSize()).toBe(0);
      const dupes = await ctx.t.db.execute(sql`
        select lead_id from activities where type = 'ASSIGNED' and lead_id in (select id from leads where name like 'Pool %')
        group by lead_id having count(*) > 1`);
      expect(dupes.rows).toHaveLength(0);
      const l = Object.values(await loads());
      expect(Math.max(...l) - Math.min(...l)).toBeLessThanOrEqual(1);
      await expectConsistentOwnership(ctx);
    });

    it("stays consistent when racing an upload, single assigns and a deactivation", async () => {
      await autoAssign();
      await addPool(12);
      const csv = [
        "name,phone",
        ...Array.from({ length: 20 }, (_, i) => `Up ${i},98770${String(i).padStart(5, "0")}`),
      ].join("\n");
      const some = (
        await ctx.t.db
          .select()
          .from(leads)
          .where(eq(leads.ownerId, uid.priya as string))
      ).slice(0, 2);
      const results = await Promise.all([
        autoAssign(),
        ctx.app.inject({
          method: "POST",
          url: "/api/leads/upload",
          headers: { cookie: cookies.admin as string },
          payload: { csv, mode: "split" },
        }),
        ...some.map((l, i) =>
          ctx.app.inject({
            method: "POST",
            url: `/api/leads/${l.id}/assign`,
            headers: { cookie: cookies.admin as string },
            payload: { ownerId: uid[i === 0 ? "rohan" : "anita"] },
          }),
        ),
        ctx.app.inject({
          method: "POST",
          url: `/api/users/${uid.rohan}/deactivate`,
          headers: { cookie: cookies.admin as string },
        }),
        autoAssign(),
      ]);
      for (const r of results) expect([200, 422], r.body).toContain(r.statusCode); // never a 500 or deadlock
      await expectConsistentOwnership(ctx);
      await expectNoOpenLeadsWithInactiveOwners(ctx);
      await autoAssign();
      expect(await poolSize()).toBe(0);
    });
  });
});
