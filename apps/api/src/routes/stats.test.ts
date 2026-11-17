import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activities, leads, settings, users } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

describe.skipIf(!hasDb)("admin insights (Phase 5)", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.ctx.close());

  const get = (as: string | null, url: string) => w.call(as, "GET", url);
  const today = () => dateInTz("Asia/Kolkata", 0);
  const isOpen = (s: string) => s !== "WON" && s !== "LOST";
  const rows = () => w.ctx.t.db.select().from(leads);
  const staleDays = async () => {
    const r = (await w.ctx.t.db.select().from(settings).where(eq(settings.key, "staleDays")))[0];
    return (r?.value as number | undefined) ?? 2;
  };
  const isStale = async (l: typeof leads.$inferSelect) =>
    isOpen(l.status) && l.lastActivityAt.getTime() < Date.now() - (await staleDays()) * 86_400_000;

  describe("authorization: admin only", () => {
    const urls = [
      "/api/stats/overview",
      "/api/stats/team",
      "/api/stats/stale",
      "/api/stats/lost-reasons",
      "/api/activity",
      "/api/settings",
    ];
    it.each(urls)("%s: admin 200, employee 403, anonymous 401", async (url) => {
      expect((await get("admin", url)).statusCode).toBe(200);
      expect((await get("priya", url)).statusCode).toBe(403);
      expect((await get(null, url)).statusCode).toBe(401);
    });
    it("employees cannot change settings", async () => {
      expect((await w.call("priya", "PUT", "/api/settings", { staleDays: 9 })).statusCode).toBe(
        403,
      );
      expect((await w.call(null, "PUT", "/api/settings", { staleDays: 9 })).statusCode).toBe(401);
      expect(await staleDays()).toBe(2);
    });
  });

  it("overview matches counts worked out independently from the raw rows", async () => {
    const all = await rows();
    const stale = (await Promise.all(all.map(isStale))).filter(Boolean).length;
    const res = await get("admin", "/api/stats/overview");
    expect(res.json()).toMatchObject({
      total: all.length,
      unassigned: all.filter((l) => !l.ownerId).length,
      open: all.filter((l) => isOpen(l.status)).length,
      won: all.filter((l) => l.status === "WON").length,
      lost: all.filter((l) => l.status === "LOST").length,
      overdue: all.filter(
        (l) => isOpen(l.status) && l.followUpDate !== null && l.followUpDate < today(),
      ).length,
      stale,
      staleDays: 2,
    });
    expect(res.json().total).toBeGreaterThan(0);
  });

  it("overdue ignores closed leads, today's follow-ups and empty dates", async () => {
    const before = (await get("admin", "/api/stats/overview")).json().overdue as number;
    const db = w.ctx.t.db;
    await db
      .update(leads)
      .set({ status: "WON", followUpDate: "2020-01-01" })
      .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
    await db
      .update(leads)
      .set({ followUpDate: today() })
      .where(eq(leads.id, w.lid["Sara Khan"] as string));
    await db
      .update(leads)
      .set({ followUpDate: null })
      .where(eq(leads.id, w.lid["Meera Iyer"] as string));
    const after = (await get("admin", "/api/stats/overview")).json().overdue as number;
    const expected = (await rows()).filter(
      (l) => isOpen(l.status) && l.followUpDate && l.followUpDate < today(),
    ).length;
    expect(after).toBe(expected);
    expect(after).toBeLessThanOrEqual(before);
    await db
      .update(leads)
      .set({ status: "QUALIFIED" })
      .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
  });

  it("team has one row per ACTIVE employee, with counts that add up and match the raw rows", async () => {
    const res = (await get("admin", "/api/stats/team")).json();
    const all = await rows();
    const emps = res.employees as {
      employeeId: string;
      name: string;
      assigned: number;
      notContacted: number;
      worked: number;
      won: number;
      lost: number;
      overdue: number;
      lastActivityAt: string | null;
    }[];
    expect(emps.map((e) => e.name).sort()).toEqual(["Anita Das", "Priya Sharma", "Rohan Verma"]);
    for (const e of emps) {
      const mine = all.filter((l) => l.ownerId === e.employeeId);
      expect(e.assigned).toBe(mine.length);
      expect(e.notContacted).toBe(mine.filter((l) => l.status === "NEW").length);
      expect(e.worked).toBe(mine.filter((l) => l.status !== "NEW").length);
      expect(e.notContacted + e.worked).toBe(e.assigned);
      expect(e.won).toBe(mine.filter((l) => l.status === "WON").length);
      expect(e.lost).toBe(mine.filter((l) => l.status === "LOST").length);
      expect(e.overdue).toBe(
        mine.filter((l) => isOpen(l.status) && l.followUpDate && l.followUpDate < today()).length,
      );
      const acts = (
        await w.ctx.t.db.select().from(activities).where(eq(activities.actorId, e.employeeId))
      ).map((a) => a.createdAt.getTime());
      expect(e.lastActivityAt ? new Date(e.lastActivityAt).getTime() : null).toBe(
        acts.length ? Math.max(...acts) : null,
      );
    }
    expect(emps.reduce((a, e) => a + e.assigned, 0) + all.filter((l) => !l.ownerId).length).toBe(
      all.length,
    );
  });

  it("an employee with no leads or activity still appears, with zeros and null last activity", async () => {
    const created = await w.call("admin", "POST", "/api/users", {
      name: "Zed New",
      email: "zed@demo.com",
      phone: "+919800000099",
    });
    expect(created.statusCode).toBe(201);
    const row = (
      (await get("admin", "/api/stats/team")).json().employees as {
        name: string;
        assigned: number;
        overdue: number;
        lastActivityAt: unknown;
      }[]
    ).find((e) => e.name === "Zed New");
    expect(row).toMatchObject({ assigned: 0, overdue: 0, lastActivityAt: null });
  });

  it("deactivated employees drop out of the team table", async () => {
    const zed = (
      await w.ctx.t.db.select().from(users).where(eq(users.email, "zed@demo.com"))
    )[0] as { id: string };
    expect((await w.call("admin", "POST", `/api/users/${zed.id}/deactivate`)).statusCode).toBe(200);
    const names = (
      (await get("admin", "/api/stats/team")).json().employees as { name: string }[]
    ).map((e) => e.name);
    expect(names).not.toContain("Zed New");
  });

  describe("stale (rule 9) and the staleDays setting", () => {
    it("lists exactly the open leads past the threshold, oldest first, with owner names", async () => {
      const res = (await get("admin", "/api/stats/stale")).json();
      const expected = (
        await Promise.all((await rows()).map(async (l) => ((await isStale(l)) ? l : null)))
      ).filter(Boolean) as (typeof leads.$inferSelect)[];
      expect(res.total).toBe(expected.length);
      expect((res.leads as { id: string }[]).map((l) => l.id).sort()).toEqual(
        expected.map((l) => l.id).sort(),
      );
      const times = (res.leads as { lastActivityAt: string }[]).map((l) =>
        new Date(l.lastActivityAt).getTime(),
      );
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(res.leads.every((l: { status: string }) => isOpen(l.status))).toBe(true);
      expect(res.leads.find((l: { name: string }) => l.name === "Meera Iyer")?.ownerName).toBe(
        "Rohan Verma",
      );
    });

    it("GET /settings defaults to 2 and PUT changes what counts as stale everywhere", async () => {
      expect((await get("admin", "/api/settings")).json()).toMatchObject({ staleDays: 2 });
      const base = (await get("admin", "/api/stats/overview")).json().stale as number;
      const put = await w.call("admin", "PUT", "/api/settings", { staleDays: 30 });
      expect(put.json()).toMatchObject({ staleDays: 30 });
      expect((await get("admin", "/api/stats/overview")).json()).toMatchObject({
        staleDays: 30,
        stale: 0,
      });
      expect((await get("admin", "/api/stats/stale")).json()).toMatchObject({
        staleDays: 30,
        total: 0,
        leads: [],
      });
      expect((await w.call("admin", "GET", "/api/leads?stale=true")).json().total).toBe(0);
      await w.call("admin", "PUT", "/api/settings", { staleDays: 1 });
      expect((await get("admin", "/api/stats/overview")).json().stale).toBeGreaterThanOrEqual(base);
      await w.call("admin", "PUT", "/api/settings", { staleDays: 2 });
      expect((await get("admin", "/api/stats/overview")).json().stale).toBe(base);
    });

    it.each([0, -1, 31, 1.5, "3", null, undefined])("rejects staleDays=%s", async (v) => {
      expect((await w.call("admin", "PUT", "/api/settings", { staleDays: v })).statusCode).toBe(
        422,
      );
      expect((await get("admin", "/api/settings")).json().staleDays).toBe(2);
    });

    it("rejects unknown keys so a typo cannot silently do nothing", async () => {
      expect(
        (await w.call("admin", "PUT", "/api/settings", { staleDays: 3, reminderTimeout: "09:00" }))
          .statusCode,
      ).toBe(422);
      expect((await get("admin", "/api/settings")).json().staleDays).toBe(2);
    });

    it("a corrupted stored value falls back to the default", async () => {
      await w.ctx.t.db
        .update(settings)
        .set({ value: "banana" })
        .where(eq(settings.key, "staleDays"));
      expect((await get("admin", "/api/settings")).json().staleDays).toBe(2);
      await w.call("admin", "PUT", "/api/settings", { staleDays: 2 });
    });
  });

  it("lost reasons: grouped counts match the raw rows, largest first, labels attached", async () => {
    const db = w.ctx.t.db;
    await db
      .update(leads)
      .set({ status: "LOST", lostReason: "PRICE" })
      .where(eq(leads.id, w.lid["Sara Khan"] as string));
    await db
      .update(leads)
      .set({ status: "LOST", lostReason: "PRICE" })
      .where(eq(leads.id, w.lid["Dev Patel"] as string));
    await db
      .update(leads)
      .set({ status: "LOST", lostReason: "NO_RESPONSE" })
      .where(eq(leads.id, w.lid["Meera Iyer"] as string));
    const res = (await get("admin", "/api/stats/lost-reasons")).json();
    const lost = (await rows()).filter((l) => l.status === "LOST");
    expect(res.total).toBe(lost.length);
    const want: Record<string, number> = {};
    for (const l of lost) want[l.lostReason as string] = (want[l.lostReason as string] ?? 0) + 1;
    expect(
      Object.fromEntries(
        res.reasons.map((r: { reason: string; count: number }) => [r.reason, r.count]),
      ),
    ).toEqual(want);
    const counts = res.reasons.map((r: { count: number }) => r.count);
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
    expect(res.reasons.find((r: { reason: string }) => r.reason === "PRICE")).toMatchObject({
      label: "Price",
      count: want.PRICE,
    });
  });

  it("lost reasons is empty, not an error, when nothing is lost", async () => {
    await w.ctx.t.db
      .update(leads)
      .set({ status: "CONTACTED", lostReason: null })
      .where(eq(leads.status, "LOST"));
    expect((await get("admin", "/api/stats/lost-reasons")).json()).toEqual({
      total: 0,
      reasons: [],
    });
  });

  describe("activity feed", () => {
    it("is newest first with actor, lead and text, and agrees with the table", async () => {
      const res = (await get("admin", "/api/activity")).json();
      const total = (await w.ctx.t.db.select().from(activities)).length;
      expect(res).toMatchObject({ page: 1, pageSize: 40, total });
      const times = (res.items as { createdAt: string }[]).map((i) =>
        new Date(i.createdAt).getTime(),
      );
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(res.items[0]).toEqual(
        expect.objectContaining({
          actorName: expect.any(String),
          leadName: expect.any(String),
          text: expect.any(String),
          leadId: expect.any(String),
        }),
      );
    });

    it("pages cover every entry exactly once, with no gaps or repeats", async () => {
      const total = (await w.ctx.t.db.select().from(activities)).length;
      const seen: string[] = [];
      for (let page = 1; page <= Math.ceil(total / 7); page++) {
        const r = (await get("admin", `/api/activity?page=${page}&pageSize=7`)).json();
        expect(r.totalPages).toBe(Math.ceil(total / 7));
        seen.push(...r.items.map((i: { id: string }) => i.id));
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
      expect((await get("admin", "/api/activity?page=999&pageSize=7")).json().items).toEqual([]);
    });

    it("new work shows up at the top", async () => {
      await w.call("priya", "POST", `/api/leads/${w.lid["Aarav Mehta"]}/notes`, {
        text: "feed check",
      });
      expect((await get("admin", "/api/activity")).json().items[0]).toMatchObject({
        text: "Note: feed check",
        actorName: "Priya Sharma",
        leadName: "Aarav Mehta",
      });
    });

    it.each(["page=0", "page=abc", "pageSize=0", "pageSize=101", "pageSize=-1"])(
      "rejects %s",
      async (q) => {
        expect((await get("admin", `/api/activity?${q}`)).statusCode).toBe(422);
      },
    );
  });
});
