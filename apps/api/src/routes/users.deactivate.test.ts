import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { activities, leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { TEST_PASSWORD, createTestApp, loginCookie, type TestApp } from "../test/app.js";

const idOf = async (ctx: TestApp, email: string) =>
  ((await ctx.t.db.select().from(users).where(eq(users.email, email)))[0] as { id: string }).id;

const post = (ctx: TestApp, url: string, cookie?: string) =>
  ctx.app.inject({ method: "POST", url, headers: cookie ? { cookie } : {} });

const countRows = async (ctx: TestApp, table: typeof activities | typeof leads) =>
  ((await ctx.t.db.select({ n: count() }).from(table))[0] as { n: number }).n;

describe.skipIf(!hasDb)("deactivate and reactivate (rule 7)", () => {
  let ctx: TestApp;
  let admin: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = (await loginCookie(ctx.app, "admin@demo.com")).cookie;
  });
  afterAll(() => ctx.close());

  const deactivate = async (email: string, cookie = admin) =>
    post(ctx, `/api/users/${await idOf(ctx, email)}/deactivate`, cookie);
  const reactivate = async (email: string, cookie = admin) =>
    post(ctx, `/api/users/${await idOf(ctx, email)}/reactivate`, cookie);

  it("returns every open lead to the pool, with an activity record each; closed leads stay put", async () => {
    const priya = await idOf(ctx, "priya@demo.com");
    const before = await ctx.t.db.select().from(leads).where(eq(leads.ownerId, priya));
    expect(before).toHaveLength(2);
    const activitiesBefore = await countRows(ctx, activities);
    const unassignedBefore = (await ctx.t.db.select().from(leads).where(isNull(leads.ownerId)))
      .length;

    const res = await deactivate("priya@demo.com");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ leadsReturned: 2, user: { isActive: false } });

    const after = await ctx.t.db.select().from(leads).where(eq(leads.ownerId, priya));
    expect(after).toHaveLength(0);
    expect((await ctx.t.db.select().from(leads).where(isNull(leads.ownerId))).length).toBe(
      unassignedBefore + 2,
    );
    // statuses are untouched
    for (const b of before) {
      const [a] = await ctx.t.db.select().from(leads).where(eq(leads.id, b.id));
      expect(a?.status).toBe(b.status);
      expect(a?.lastActivityAt.getTime()).toBeGreaterThan(b.lastActivityAt.getTime());
    }
    // exactly one new activity per returned lead, by the admin
    expect(await countRows(ctx, activities)).toBe(activitiesBefore + 2);
    const rows = await ctx.t.db.select().from(activities).where(eq(activities.type, "UNASSIGNED"));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.text).toBe("Moved back to unassigned pool");
      expect(r.actorId).toBe(await idOf(ctx, "admin@demo.com"));
      expect(r.meta).toMatchObject({ fromOwnerId: priya });
    }
  });

  it("keeps Won and Lost leads with the deactivated employee, history intact", async () => {
    const anita = await idOf(ctx, "anita@demo.com");
    const closedBefore = await ctx.t.db.select().from(leads).where(eq(leads.ownerId, anita));
    expect(closedBefore.map((l) => l.status).sort()).toEqual(["LOST", "WON"]);
    const activitiesBefore = await countRows(ctx, activities);

    const res = await deactivate("anita@demo.com");
    expect(res.json().leadsReturned).toBe(0);
    const closedAfter = await ctx.t.db.select().from(leads).where(eq(leads.ownerId, anita));
    expect(closedAfter).toHaveLength(2);
    expect(await countRows(ctx, activities)).toBe(activitiesBefore); // nothing written
    await reactivate("anita@demo.com");
  });

  it("blocks login and kills an existing session immediately", async () => {
    const session = (await loginCookie(ctx.app, "rohan@demo.com")).cookie;
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: session } }))
        .statusCode,
    ).toBe(200);
    await deactivate("rohan@demo.com");
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: session } }))
        .statusCode,
    ).toBe(401);
    expect((await loginCookie(ctx.app, "rohan@demo.com")).res.statusCode).toBe(401);
  });

  it("is idempotent: deactivating an inactive employee changes nothing", async () => {
    const before = await countRows(ctx, activities);
    const res = await deactivate("priya@demo.com");
    expect(res.statusCode).toBe(200);
    expect(res.json().leadsReturned).toBe(0);
    expect(await countRows(ctx, activities)).toBe(before);
  });

  it("reactivates: login works again, but leads are not handed back", async () => {
    const res = await reactivate("priya@demo.com");
    expect(res.statusCode).toBe(200);
    expect(res.json().user.isActive).toBe(true);
    expect((await loginCookie(ctx.app, "priya@demo.com")).res.statusCode).toBe(200);
    const priya = await idOf(ctx, "priya@demo.com");
    expect(await ctx.t.db.select().from(leads).where(eq(leads.ownerId, priya))).toHaveLength(0);
    await reactivate("rohan@demo.com");
  });

  it("only works on employees, known ids, and for admins", async () => {
    const adminId = await idOf(ctx, "admin@demo.com");
    expect((await post(ctx, `/api/users/${adminId}/deactivate`, admin)).json().error.code).toBe(
      "NOT_AN_EMPLOYEE",
    );
    expect((await post(ctx, `/api/users/${adminId}/reactivate`, admin)).statusCode).toBe(409);
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await post(ctx, `/api/users/${ghost}/deactivate`, admin)).statusCode).toBe(404);
    expect((await post(ctx, `/api/users/${ghost}/reactivate`, admin)).statusCode).toBe(404);
    expect((await post(ctx, "/api/users/not-a-uuid/deactivate", admin)).statusCode).toBe(422);

    const employee = (await loginCookie(ctx.app, "priya@demo.com")).cookie;
    const target = await idOf(ctx, "rohan@demo.com");
    expect((await post(ctx, `/api/users/${target}/deactivate`, employee)).statusCode).toBe(403);
    expect((await post(ctx, `/api/users/${target}/reactivate`, employee)).statusCode).toBe(403);
    expect((await post(ctx, `/api/users/${target}/deactivate`)).statusCode).toBe(401);
    expect((await ctx.t.db.select().from(users).where(eq(users.id, target)))[0]?.isActive).toBe(
      true,
    );
  });
});

describe.skipIf(!hasDb)("the last active employee", () => {
  let ctx: TestApp;
  let admin: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = (await loginCookie(ctx.app, "admin@demo.com")).cookie;
  });
  afterAll(() => ctx.close());

  const toggle = async (email: string, action: "deactivate" | "reactivate") =>
    post(ctx, `/api/users/${await idOf(ctx, email)}/${action}`, admin);
  const activeEmployees = async () =>
    (await ctx.t.db.select().from(users).where(eq(users.role, "EMPLOYEE"))).filter(
      (u) => u.isActive,
    ).length;

  it("cannot be deactivated, and nothing changes when it is refused", async () => {
    expect((await toggle("anita@demo.com", "deactivate")).statusCode).toBe(200);
    expect((await toggle("rohan@demo.com", "deactivate")).statusCode).toBe(200);
    const leadsBefore = await ctx.t.db.select().from(leads);
    const activitiesBefore = await countRows(ctx, activities);

    const res = await toggle("priya@demo.com", "deactivate");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LAST_ACTIVE_EMPLOYEE");
    expect(await activeEmployees()).toBe(1);
    expect(await ctx.t.db.select().from(leads)).toEqual(leadsBefore);
    expect(await countRows(ctx, activities)).toBe(activitiesBefore);

    await toggle("anita@demo.com", "reactivate");
    await toggle("rohan@demo.com", "reactivate");
  });

  it("holds under concurrency: two simultaneous deactivations of the last two never leave zero", async () => {
    await toggle("anita@demo.com", "deactivate"); // priya + rohan remain
    for (let round = 0; round < 5; round++) {
      const [a, b] = await Promise.all([
        toggle("priya@demo.com", "deactivate"),
        toggle("rohan@demo.com", "deactivate"),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      expect(await activeEmployees()).toBe(1);
      await toggle("priya@demo.com", "reactivate");
      await toggle("rohan@demo.com", "reactivate");
    }
  });
});

describe.skipIf(!hasDb)("deactivation is one transaction", () => {
  let ctx: TestApp;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it("rolls everything back if any step fails", async () => {
    const admin = (await loginCookie(ctx.app, "admin@demo.com")).cookie;
    const priya = await idOf(ctx, "priya@demo.com");
    // Make the 2nd activity insert blow up, i.e. after leads were already updated in the same transaction.
    await ctx.t.db.execute(sql`
      CREATE FUNCTION boom() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'UNASSIGNED' THEN RAISE EXCEPTION 'simulated failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await ctx.t.db.execute(
      sql`CREATE TRIGGER boom BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION boom()`,
    );

    const leadsBefore = await ctx.t.db.select().from(leads).orderBy(leads.id);
    const activitiesBefore = await countRows(ctx, activities);

    const res = await post(ctx, `/api/users/${priya}/deactivate`, admin);
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).not.toMatch(/simulated/); // internals not leaked

    expect((await ctx.t.db.select().from(users).where(eq(users.id, priya)))[0]?.isActive).toBe(
      true,
    );
    expect(await ctx.t.db.select().from(leads).orderBy(leads.id)).toEqual(leadsBefore);
    expect(await countRows(ctx, activities)).toBe(activitiesBefore);
    expect((await loginCookie(ctx.app, "priya@demo.com", TEST_PASSWORD)).res.statusCode).toBe(200);

    await ctx.t.db.execute(sql`DROP TRIGGER boom ON activities`);
    expect((await post(ctx, `/api/users/${priya}/deactivate`, admin)).statusCode).toBe(200); // works once fixed
  });
});
