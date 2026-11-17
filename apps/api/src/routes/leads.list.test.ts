import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leads, settings, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createTestApp, loginCookie, type TestApp } from "../test/app.js";

interface Row {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  status: string;
  isStale: boolean;
  lastActivityText: string | null;
  phone: string;
}
interface Page {
  leads: Row[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

describe.skipIf(!hasDb)("GET /api/leads", () => {
  let ctx: TestApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const e of ["admin", "priya", "rohan", "anita"]) {
      cookies[e] = (await loginCookie(ctx.app, `${e}@demo.com`)).cookie;
      ids[e] = (
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

  const list = async (as: string, query = ""): Promise<Page> => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/leads${query}`,
      headers: { cookie: cookies[as] as string },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const names = (p: Page) => p.leads.map((l) => l.name).sort();

  describe("as admin", () => {
    it("sees every lead with owner name and last action", async () => {
      const p = await list("admin");
      expect(p.total).toBe(9);
      expect(p.leads).toHaveLength(9);
      const by = Object.fromEntries(p.leads.map((l) => [l.name, l]));
      expect(by["Sara Khan"]).toMatchObject({
        ownerName: "Priya Sharma",
        lastActivityText: "Call: No answer",
      });
      expect(by["Dev Patel"]?.lastActivityText).toBe("Status: Qualified → Proposal");
      expect(by["Nisha Rao"]?.lastActivityText).toBe("Status: Contacted → Lost (Wrong contact)");
      expect(by["Imran Ali"]).toMatchObject({
        ownerId: null,
        ownerName: null,
        lastActivityText: "Uploaded by Admin",
      });
    });

    it("filters by owner, unassigned and status", async () => {
      expect(names(await list("admin", `?owner=${ids.priya}`))).toEqual([
        "Aarav Mehta",
        "Sara Khan",
      ]);
      expect(names(await list("admin", "?owner=none"))).toEqual([
        "Imran Ali",
        "Tara Nair",
        "Vikram Joshi",
      ]);
      expect(names(await list("admin", "?status=WON"))).toEqual(["Kabir Singh"]);
      expect(names(await list("admin", "?status=LOST"))).toEqual(["Nisha Rao"]);
    });

    it("combines filters with AND", async () => {
      expect(names(await list("admin", `?owner=${ids.rohan}&status=NEW`))).toEqual(["Meera Iyer"]);
      expect(await list("admin", `?owner=${ids.priya}&status=WON`)).toMatchObject({
        total: 0,
        leads: [],
      });
    });

    it("flags stale leads: open and quiet for more than staleDays (default 2)", async () => {
      const stale = await list("admin", "?stale=true");
      expect(names(stale)).toEqual(["Imran Ali", "Meera Iyer", "Tara Nair", "Vikram Joshi"]);
      expect(stale.leads.every((l) => l.isStale)).toBe(true);
      const fresh = await list("admin", "?stale=false");
      expect(names(fresh)).toEqual([
        "Aarav Mehta",
        "Dev Patel",
        "Kabir Singh",
        "Nisha Rao",
        "Sara Khan",
      ]);
      expect(fresh.leads.every((l) => !l.isStale)).toBe(true);
    });

    it("never calls a Won or Lost lead stale, however old", async () => {
      const closed = (await list("admin")).leads.filter(
        (l) => l.status === "WON" || l.status === "LOST",
      );
      expect(closed).toHaveLength(2);
      expect(closed.every((l) => !l.isStale)).toBe(true);
    });

    it("follows the admin staleDays setting", async () => {
      const setDays = (n: number) =>
        ctx.t.db.update(settings).set({ value: n }).where(eq(settings.key, "staleDays"));
      await setDays(1); // 24h: Sara (30h) joins
      expect(names(await list("admin", "?stale=true"))).toContain("Sara Khan");
      await setDays(4); // 96h: nothing is that old
      expect((await list("admin", "?stale=true")).total).toBe(0);
      await setDays(2);
      expect((await list("admin", "?stale=true")).total).toBe(4);
    });

    it("searches name, company and phone, in any case and format", async () => {
      expect(names(await list("admin", "?search=aarav"))).toEqual(["Aarav Mehta"]);
      expect(names(await list("admin", "?search=NORTHWIND"))).toEqual(["Aarav Mehta"]);
      expect(names(await list("admin", "?search=" + encodeURIComponent("98100 00007")))).toEqual([
        "Imran Ali",
      ]);
      expect(
        names(await list("admin", "?search=" + encodeURIComponent("+91 98100-00008"))),
      ).toEqual(["Tara Nair"]);
      expect(names(await list("admin", "?search=9810000009"))).toEqual(["Vikram Joshi"]);
      expect((await list("admin", "?search=zzz-nothing")).total).toBe(0);
    });

    it("treats % and _ in search as plain text, not wildcards", async () => {
      expect((await list("admin", "?search=%25")).total).toBe(0);
      expect((await list("admin", "?search=_")).total).toBe(0);
      expect((await list("admin", "?search=" + encodeURIComponent("a%"))).total).toBe(0);
    });

    it("paginates stably: pages are disjoint and together cover everything", async () => {
      const seen: string[] = [];
      for (let page = 1; page <= 5; page++) {
        const p = await list("admin", `?pageSize=2&page=${page}`);
        expect(p.totalPages).toBe(5);
        expect(p.total).toBe(9);
        expect(p.leads).toHaveLength(page < 5 ? 2 : 1);
        seen.push(...p.leads.map((l) => l.id));
      }
      expect(new Set(seen).size).toBe(9);
      expect((await list("admin", "?pageSize=2&page=6")).leads).toEqual([]);
    });

    it("rejects bad query parameters with 422", async () => {
      for (const q of [
        "?page=0",
        "?pageSize=0",
        "?pageSize=101",
        "?owner=abc",
        "?status=FOO",
        "?stale=maybe",
        "?page=x",
      ]) {
        const res = await ctx.app.inject({
          method: "GET",
          url: `/api/leads${q}`,
          headers: { cookie: cookies.admin as string },
        });
        expect(res.statusCode, q).toBe(422);
      }
    });
  });

  describe("as employee (rule 3: only own leads, enforced in the query)", () => {
    it("sees only their own leads, overdue follow-up first", async () => {
      const p = await list("priya");
      expect(p.total).toBe(2);
      expect(p.leads.map((l) => l.name)).toEqual(["Sara Khan", "Aarav Mehta"]); // Sara's follow-up is overdue
      expect(p.leads.every((l) => l.ownerId === ids.priya)).toBe(true);
    });

    it("puts closed leads after open ones", async () => {
      await ctx.t.db
        .update(leads)
        .set({ ownerId: ids.priya })
        .where(eq(leads.phone, "+919810000005")); // Kabir, Won
      const p = await list("priya");
      expect(p.leads.map((l) => l.name)).toEqual(["Sara Khan", "Aarav Mehta", "Kabir Singh"]);
      await ctx.t.db
        .update(leads)
        .set({ ownerId: ids.anita })
        .where(eq(leads.phone, "+919810000005"));
    });

    it("never returns anyone else's lead, whatever filters, search or paging are used", async () => {
      const everyone = (await list("admin", "?pageSize=100")).leads;
      const employees = ["priya", "rohan", "anita"];
      for (const me of employees) {
        const others = employees.filter((e) => e !== me);
        const queries = [
          "",
          "?pageSize=100",
          "?owner=none",
          "?stale=true",
          "?stale=false",
          "?status=NEW",
          "?status=WON",
          "?pageSize=1&page=2",
          ...others.map((o) => `?owner=${ids[o]}`),
          ...others.map((o) => `?owner=${ids[o]}&pageSize=100`),
          ...everyone
            .filter((l) => l.ownerId !== ids[me])
            .flatMap((l) => [
              `?search=${encodeURIComponent(l.name)}`,
              `?search=${encodeURIComponent(l.phone)}`,
              `?search=${encodeURIComponent(l.name)}&owner=${l.ownerId ?? "none"}`,
            ]),
        ];
        for (const q of queries) {
          const p = await list(me, q);
          expect(
            p.leads.every((l) => l.ownerId === ids[me]),
            `${me} ${q}`,
          ).toBe(true);
          expect(p.total, `${me} ${q}`).toBeLessThanOrEqual(
            everyone.filter((l) => l.ownerId === ids[me]).length,
          );
        }
        // Looking for someone else's lead specifically finds nothing and leaks no counts.
        for (const o of others)
          expect(await list(me, `?owner=${ids[o]}`)).toMatchObject({ total: 0, leads: [] });
      }
    });

    it("cannot see the unassigned pool", async () => {
      for (const me of ["priya", "rohan", "anita"]) {
        expect((await list(me, "?owner=none")).total).toBe(0);
        expect((await list(me, "?search=Imran")).total).toBe(0);
      }
    });

    it("applies the stale filter to their own leads only", async () => {
      expect((await list("priya", "?stale=true")).total).toBe(0);
      expect(names(await list("rohan", "?stale=true"))).toEqual(["Meera Iyer"]); // not the 3 stale pool leads
    });

    it("gives different employees different results", async () => {
      expect(names(await list("rohan"))).toEqual(["Dev Patel", "Meera Iyer"]);
      expect(names(await list("anita"))).toEqual(["Kabir Singh", "Nisha Rao"]);
    });

    it("stops listing the moment the employee is deactivated", async () => {
      const cookie = (await loginCookie(ctx.app, "anita@demo.com")).cookie;
      await ctx.t.db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, ids.anita as string));
      const res = await ctx.app.inject({ method: "GET", url: "/api/leads", headers: { cookie } });
      expect(res.statusCode).toBe(401);
      await ctx.t.db
        .update(users)
        .set({ isActive: true })
        .where(eq(users.id, ids.anita as string));
    });
  });

  it("requires a session and a changed temporary password", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/leads" })).statusCode).toBe(401);
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, ids.rohan as string));
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/leads",
      headers: { cookie: cookies.rohan as string },
    });
    expect(res.statusCode).toBe(403);
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, ids.rohan as string));
  });
});
