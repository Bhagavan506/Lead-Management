import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { leads, reminderLog, users } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { startScheduler, timeInTz } from "../scheduler.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";
import { MockProvider } from "../whatsapp/mock.js";
import { runReminders } from "./reminders.js";

const TZ = "Asia/Kolkata";

describe.skipIf(!hasDb)("reminder job (9.1, 9.2)", () => {
  let w: World;
  let provider: MockProvider;
  const day = (n = 0) => dateInTz(TZ, n);
  const db = () => w.ctx.t.db;
  const setLead = (name: string, p: Partial<typeof leads.$inferInsert>) =>
    db()
      .update(leads)
      .set(p)
      .where(eq(leads.id, w.lid[name] as string));
  const run = (kind: "SCHEDULED" | "MANUAL" = "SCHEDULED", now?: Date) =>
    runReminders(db(), provider, { kind, timeZone: TZ, now });
  const logs = () => db().select().from(reminderLog);

  beforeAll(async () => {
    w = await createWorld();
    provider = w.ctx.provider;
  });
  afterAll(() => w.ctx.close());

  beforeEach(async () => {
    // A known starting point: nothing due, nothing sent.
    await db().delete(reminderLog);
    provider.sent.length = 0;
    provider.failWith = null;
    await db().update(leads).set({ followUpDate: null });
    await db().update(users).set({ isActive: true });
    await setLead("Aarav Mehta", {
      status: "QUALIFIED",
      ownerId: w.uid.priya,
      followUpDate: day(-1),
    }); // Priya: overdue
    await setLead("Sara Khan", { status: "CONTACTED", ownerId: w.uid.priya, followUpDate: day(0) }); // Priya: today
    await setLead("Dev Patel", { status: "CONTACTED", ownerId: w.uid.rohan, followUpDate: day(0) }); // Rohan: today
  });

  it("sends one message per employee with due or overdue follow-ups, to their own number only", async () => {
    const r = await run();
    expect(r).toMatchObject({
      date: day(),
      kind: "SCHEDULED",
      sent: 2,
      failed: 0,
      alreadySent: 0,
      noPhone: [],
    });
    const priya = (
      await db()
        .select()
        .from(users)
        .where(eq(users.id, w.uid.priya as string))
    )[0];
    const msg = provider.sent.find((m) => m.to === priya?.phone);
    expect(msg?.text).toBe(
      "Hi Priya, you have 2 follow-ups due today or overdue: Aarav Mehta (overdue), Sara Khan. Open Leadbook to update them.",
    );
    const rohan = provider.sent.find((m) => m.text.startsWith("Hi Rohan"));
    expect(rohan?.text).toContain("Dev Patel");
    expect(rohan?.text).not.toContain("Aarav");
    expect(provider.sent).toHaveLength(2);
  });

  it("writes a ReminderLog row per message with provider, id, status, date and exact text", async () => {
    await run();
    const rows = await logs();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: "SCHEDULED",
        provider: "mock",
        status: "SENT",
        date: day(),
      });
      expect(row.providerMessageId).toMatch(/^mock-/);
      expect(provider.sent.some((m) => m.text === row.messageText)).toBe(true);
    }
    expect(new Set(rows.map((r) => r.employeeId))).toEqual(new Set([w.uid.priya, w.uid.rohan]));
  });

  it("running the job twice sends once (rule 10)", async () => {
    expect((await run()).sent).toBe(2);
    const again = await run();
    expect(again).toMatchObject({ sent: 0, alreadySent: 2 });
    expect(provider.sent).toHaveLength(2);
    expect(await logs()).toHaveLength(2);
  });

  it("simultaneous runs (several processes, or a double trigger) still send once", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => run()));
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(2);
    expect(provider.sent).toHaveLength(2);
    expect(await logs()).toHaveLength(2);
  });

  it("the database itself refuses a second scheduled row for the same employee and day", async () => {
    await run();
    await expect(
      db()
        .insert(reminderLog)
        .values({
          employeeId: w.uid.priya as string,
          date: day(),
          kind: "SCHEDULED",
          messageText: "x",
          provider: "mock",
          status: "SENT",
        }),
    ).rejects.toThrow();
  });

  it("a follow-up that becomes due later the same day does not trigger a second message; the next day does", async () => {
    await run();
    await setLead("Meera Iyer", {
      status: "CONTACTED",
      ownerId: w.uid.anita,
      followUpDate: day(0),
    }); // Anita newly due
    await run();
    expect(provider.sent.some((m) => m.text.startsWith("Hi Anita"))).toBe(true); // a different employee, so she is still reminded
    const before = provider.sent.length;
    await run();
    expect(provider.sent).toHaveLength(before); // nothing new for anyone
    const tomorrow = new Date(Date.now() + 86_400_000);
    await setLead("Aarav Mehta", { followUpDate: day(0) });
    const next = await run("SCHEDULED", tomorrow);
    expect(next.date).toBe(day(1));
    expect(next.sent).toBeGreaterThan(0);
  });

  it("skips employees with nothing due: future dates, no date, closed leads, unassigned leads", async () => {
    await setLead("Aarav Mehta", { followUpDate: day(1) });
    await setLead("Sara Khan", { followUpDate: null });
    await setLead("Dev Patel", { status: "WON", followUpDate: day(-3) });
    await setLead("Imran Ali", { ownerId: null, status: "NEW", followUpDate: day(-1) });
    expect(await run()).toMatchObject({ sent: 0, failed: 0, alreadySent: 0 });
    expect(provider.sent).toEqual([]);
    expect(await logs()).toEqual([]);
  });

  it("never reminds a deactivated employee", async () => {
    await db()
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, w.uid.rohan as string));
    expect((await run()).sent).toBe(1);
    expect(provider.sent.some((m) => m.text.startsWith("Hi Rohan"))).toBe(false);
  });

  it("reports employees who have due follow-ups but no number, and sends them nothing", async () => {
    await db()
      .update(users)
      .set({ phone: null })
      .where(eq(users.id, w.uid.rohan as string));
    const r = await run();
    expect(r).toMatchObject({ sent: 1, noPhone: ["Rohan Verma"] });
    expect(await logs()).toHaveLength(1);
    await db()
      .update(users)
      .set({ phone: "+919820000002" })
      .where(eq(users.id, w.uid.rohan as string));
  });

  it("records a failed send as FAILED, keeps going, and does not retry on the scheduled run", async () => {
    provider.failWith = "template not approved";
    const r = await run();
    expect(r).toMatchObject({ sent: 0, failed: 2 });
    expect((await logs()).every((l) => l.status === "FAILED" && l.providerMessageId === null)).toBe(
      true,
    );
    provider.failWith = null;
    expect(await run()).toMatchObject({ sent: 0, alreadySent: 2 }); // the day's attempt is spent
    expect((await run("MANUAL")).sent).toBe(2); // an admin can retry with Send now
  });

  it("a provider that throws is a FAILED row, not a crashed run", async () => {
    const boom = { name: "boom", send: async () => Promise.reject(new Error("network down")) };
    const r = await runReminders(db(), boom, { kind: "SCHEDULED", timeZone: TZ });
    expect(r).toMatchObject({ sent: 0, failed: 2 });
    expect((await logs()).map((l) => l.provider)).toEqual(["boom", "boom"]);
  });

  describe("manual 'Send now'", () => {
    it("is allowed after the scheduled run the same day, and recorded as MANUAL", async () => {
      await run("SCHEDULED");
      expect((await run("MANUAL")).sent).toBe(2);
      expect((await logs()).filter((l) => l.kind === "MANUAL")).toHaveLength(2);
    });

    it("ignores a repeat within the cooldown (double click) but works again after it", async () => {
      expect((await run("MANUAL")).sent).toBe(2);
      expect(await run("MANUAL")).toMatchObject({ sent: 0, alreadySent: 2 });
      await db()
        .update(reminderLog)
        .set({ createdAt: sql`now() - interval '2 minutes'` });
      expect((await run("MANUAL")).sent).toBe(2);
    });
  });

  describe("scheduler", () => {
    const at = (iso: string) => new Date(iso); // IST = UTC+5:30, so 04:00Z is 09:30 IST
    const settings = (enabled: boolean, time = "09:00") =>
      w.call("admin", "PUT", "/api/settings", { reminderEnabled: enabled, reminderTime: time });

    it("timeInTz reads the clock in the app timezone", () => {
      expect(timeInTz(TZ, at("2031-01-10T00:00:00Z"))).toBe("05:30");
      expect(timeInTz(TZ, at("2031-01-10T18:30:00Z"))).toBe("00:00");
      expect(timeInTz("UTC", at("2031-01-10T23:59:00Z"))).toBe("23:59");
    });

    it("does nothing while reminders are off or before the chosen time, then sends once a day", async () => {
      const s = startScheduler(w.ctx.app, { everyMs: 1e9, immediate: false });
      await settings(false);
      await s.tick(at("2031-01-10T04:00:00Z"));
      expect(provider.sent).toHaveLength(0);

      await settings(true, "09:00");
      await s.tick(at("2031-01-10T03:00:00Z")); // 08:30 IST, too early
      expect(provider.sent).toHaveLength(0);

      await s.tick(at("2031-01-10T03:30:00Z")); // 09:00 IST on the dot
      const sent = provider.sent.length;
      expect(sent).toBeGreaterThan(0);
      await s.tick(at("2031-01-10T08:00:00Z")); // later the same day: no second run
      await s.tick(at("2031-01-10T09:00:00Z"));
      expect(provider.sent).toHaveLength(sent);
      s.stop();
    });

    it("a restarted scheduler after the send time does not send again (the database remembers)", async () => {
      await settings(true, "09:00");
      const when = at(`${day(0)}T10:00:00Z`);
      const first = startScheduler(w.ctx.app, { everyMs: 1e9, immediate: false });
      await first.tick(when);
      first.stop();
      const sent = provider.sent.length;
      expect(sent).toBeGreaterThan(0);
      const second = startScheduler(w.ctx.app, { everyMs: 1e9, immediate: false }); // "process restarted"
      await second.tick(when);
      second.stop();
      expect(provider.sent).toHaveLength(sent);
    });
  });
});
