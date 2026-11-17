import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leads, reminderLog } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

describe.skipIf(!hasDb)("reminder settings, Send now, log and employee panel (9.3)", () => {
  let w: World;
  const day = (n = 0) => dateInTz("Asia/Kolkata", n);
  const db = () => w.ctx.t.db;
  const setting = (body: unknown) => w.call("admin", "PUT", "/api/settings", body);

  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.ctx.close());
  beforeEach(async () => {
    await db().delete(reminderLog);
    w.ctx.provider.sent.length = 0;
    await db().update(leads).set({ followUpDate: null });
    await db()
      .update(leads)
      .set({ status: "QUALIFIED", ownerId: w.uid.priya as string, followUpDate: day(-1) })
      .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
    await db()
      .update(leads)
      .set({ status: "CONTACTED", ownerId: w.uid.rohan as string, followUpDate: day(0) })
      .where(eq(leads.id, w.lid["Dev Patel"] as string));
    await setting({ reminderEnabled: true, reminderTime: "09:00" });
  });

  describe("settings", () => {
    it("start off-by-default values are readable, and changes persist without touching other settings", async () => {
      expect((await setting({ reminderTime: "08:30" })).json()).toMatchObject({
        reminderEnabled: true,
        reminderTime: "08:30",
        staleDays: 2,
      });
      expect((await setting({ reminderEnabled: false })).json()).toMatchObject({
        reminderEnabled: false,
        reminderTime: "08:30",
      });
      expect((await w.call("admin", "GET", "/api/settings")).json()).toEqual({
        staleDays: 2,
        reminderEnabled: false,
        reminderTime: "08:30",
      });
    });

    it.each(["9:00", "24:00", "09:60", "0900", "09:00:00", "", "noon", 900, null])(
      "rejects reminderTime %j",
      async (v) => {
        expect((await setting({ reminderTime: v })).statusCode).toBe(422);
        expect((await w.call("admin", "GET", "/api/settings")).json().reminderTime).toBe("09:00");
      },
    );

    it.each(["true", 1, "yes", null])(
      "rejects reminderEnabled %j (must be a real boolean)",
      async (v) => {
        expect((await setting({ reminderEnabled: v })).statusCode).toBe(422);
        expect((await w.call("admin", "GET", "/api/settings")).json().reminderEnabled).toBe(true);
      },
    );

    it("rejects an empty update", async () => {
      expect((await setting({})).statusCode).toBe(422);
    });

    it("employees cannot read or change them", async () => {
      expect(
        (await w.call("priya", "PUT", "/api/settings", { reminderEnabled: false })).statusCode,
      ).toBe(403);
      expect((await w.call("priya", "GET", "/api/settings")).statusCode).toBe(403);
    });
  });

  describe("GET /api/reminders/due (preview)", () => {
    it("shows each employee's due leads and the exact message, admin only", async () => {
      const res = await w.call("admin", "GET", "/api/reminders/due");
      expect(res.statusCode).toBe(200);
      const { employees, today } = res.json();
      expect(today).toBe(day());
      const priya = employees.find((e: { name: string }) => e.name === "Priya Sharma");
      expect(priya.leads).toEqual([
        { id: w.lid["Aarav Mehta"], name: "Aarav Mehta", followUpDate: day(-1), overdue: true },
      ]);
      expect(priya.message).toBe(
        "Hi Priya, you have 1 follow-up due today or overdue: Aarav Mehta (overdue). Open Leadbook to update them.",
      );
      expect(employees.map((e: { name: string }) => e.name)).toEqual([
        "Priya Sharma",
        "Rohan Verma",
      ]);
      expect((await w.call("priya", "GET", "/api/reminders/due")).statusCode).toBe(403);
      expect((await w.call(null, "GET", "/api/reminders/due")).statusCode).toBe(401);
      expect(w.ctx.provider.sent).toHaveLength(0); // previewing sends nothing
    });
  });

  describe("POST /api/reminders/send-now", () => {
    it("sends to employees with due follow-ups and reports the counts", async () => {
      const res = await w.call("admin", "POST", "/api/reminders/send-now");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        kind: "MANUAL",
        sent: 2,
        failed: 0,
        alreadySent: 0,
        noPhone: [],
      });
      expect(w.ctx.provider.sent).toHaveLength(2);
      expect((await db().select().from(reminderLog)).every((r) => r.kind === "MANUAL")).toBe(true);
    });

    it("refuses while reminders are off, and sends nothing", async () => {
      await setting({ reminderEnabled: false });
      const res = await w.call("admin", "POST", "/api/reminders/send-now");
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("REMINDERS_DISABLED");
      expect(w.ctx.provider.sent).toHaveLength(0);
    });

    it("a double click (two requests at once) sends one message per employee, not two", async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => w.call("admin", "POST", "/api/reminders/send-now")),
      );
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(results.reduce((n, r) => n + r.json().sent, 0)).toBe(2);
      expect(w.ctx.provider.sent).toHaveLength(2);
      expect(await db().select().from(reminderLog)).toHaveLength(2);
    });

    it("reports failures and keeps the failed attempt in the log", async () => {
      w.ctx.provider.failWith = "Meta said no";
      const res = await w.call("admin", "POST", "/api/reminders/send-now");
      expect(res.json()).toMatchObject({ sent: 0, failed: 2 });
      w.ctx.provider.failWith = null;
      expect(
        (await w.call("admin", "GET", "/api/reminders/log"))
          .json()
          .items.every((i: { status: string }) => i.status === "FAILED"),
      ).toBe(true);
    });

    it("is admin only", async () => {
      expect((await w.call("priya", "POST", "/api/reminders/send-now")).statusCode).toBe(403);
      expect((await w.call(null, "POST", "/api/reminders/send-now")).statusCode).toBe(401);
      expect(w.ctx.provider.sent).toHaveLength(0);
    });
  });

  describe("GET /api/reminders/log", () => {
    it("lists what was sent, newest first, with employee names, and pages", async () => {
      await w.call("admin", "POST", "/api/reminders/send-now");
      const res = await w.call("admin", "GET", "/api/reminders/log?pageSize=1");
      expect(res.json()).toMatchObject({ total: 2, totalPages: 2, page: 1, pageSize: 1 });
      const all = (await w.call("admin", "GET", "/api/reminders/log")).json().items;
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(
        expect.objectContaining({
          employeeName: expect.any(String),
          kind: "MANUAL",
          status: "SENT",
          provider: "mock",
          date: day(),
          messageText: expect.stringContaining("Hi "),
        }),
      );
      const times = all.map((i: { createdAt: string }) => new Date(i.createdAt).getTime());
      expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
    });

    it("is admin only and validates paging", async () => {
      expect((await w.call("priya", "GET", "/api/reminders/log")).statusCode).toBe(403);
      expect((await w.call(null, "GET", "/api/reminders/log")).statusCode).toBe(401);
      expect((await w.call("admin", "GET", "/api/reminders/log?pageSize=101")).statusCode).toBe(
        422,
      );
      expect((await w.call("admin", "GET", "/api/reminders/log?page=0")).statusCode).toBe(422);
    });
  });

  describe("GET /api/reminders/mine (employee panel)", () => {
    it("shows the setting, the employee's own number and ONLY their own recent messages", async () => {
      await w.call("admin", "POST", "/api/reminders/send-now");
      const priya = (await w.call("priya", "GET", "/api/reminders/mine")).json();
      expect(priya).toMatchObject({ enabled: true, time: "09:00" });
      expect(priya.phone).toMatch(/^\+91/);
      expect(priya.recent).toHaveLength(1);
      expect(priya.recent[0].messageText).toContain("Hi Priya");
      expect(priya.recent[0].messageText).not.toContain("Dev Patel");
      const rohan = (await w.call("rohan", "GET", "/api/reminders/mine")).json();
      expect(rohan.recent).toHaveLength(1);
      expect(rohan.recent[0].messageText).toContain("Hi Rohan");
      expect((await w.call("anita", "GET", "/api/reminders/mine")).json().recent).toEqual([]);
    });

    it("shows at most the last three", async () => {
      for (let i = 0; i < 4; i++) {
        await w.call("admin", "POST", "/api/reminders/send-now");
        await db()
          .update(reminderLog)
          .set({ createdAt: new Date(Date.now() - (4 - i) * 3_600_000) })
          .where(eq(reminderLog.employeeId, w.uid.priya as string));
      }
      expect(
        (await w.call("priya", "GET", "/api/reminders/mine")).json().recent.length,
      ).toBeLessThanOrEqual(3);
    });

    it("reflects reminders being off, and is employee only", async () => {
      await setting({ reminderEnabled: false });
      expect((await w.call("priya", "GET", "/api/reminders/mine")).json().enabled).toBe(false);
      expect((await w.call("admin", "GET", "/api/reminders/mine")).statusCode).toBe(403);
      expect((await w.call(null, "GET", "/api/reminders/mine")).statusCode).toBe(401);
    });
  });
});
