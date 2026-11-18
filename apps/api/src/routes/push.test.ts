import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leads, pushSubscriptions, reminderLog } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { PushNotifier, type WebPushSend } from "../push/notifier.js";
import { PushProvider } from "../push/provider.js";
import { runReminders } from "../services/reminders.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

const sub = (n: number) => ({
  endpoint: `https://push.example.com/device-${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

describe.skipIf(!hasDb)("browser push: devices, test push, reminders, lead-assigned", () => {
  let w: World;
  let notifier: PushNotifier;
  const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  const failures = new Map<string, number>(); // endpoint -> status code to fail with
  const fake: WebPushSend = async (s, payload) => {
    const code = failures.get(s.endpoint);
    if (code) throw Object.assign(new Error("push failed"), { statusCode: code });
    sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
  };
  const db = () => w.ctx.t.db;
  const day = (n = 0) => dateInTz("Asia/Kolkata", n);
  const subscribe = (as: string | null, n: number) =>
    w.call(as, "POST", "/api/push/subscribe", sub(n));
  const devices = async (email: string) =>
    (await db().select().from(pushSubscriptions)).filter((s) => s.userId === w.uid[email]).length;
  const flush = () => new Promise((r) => setTimeout(r, 100));

  beforeAll(async () => {
    w = await createWorld(
      {},
      {
        makePush: (d) =>
          (notifier = new PushNotifier(
            d,
            { publicKey: "PUBKEY", privateKey: "x", subject: "mailto:a@b.c" },
            fake,
          )),
        pushProvider: (p) => new PushProvider(p),
      },
    );
  });
  afterAll(() => w.ctx.close());
  beforeEach(async () => {
    sent.length = 0;
    failures.clear();
    await db().delete(pushSubscriptions);
    await db().delete(reminderLog);
  });

  describe("registering devices", () => {
    it("employees get the public key; admins and anonymous callers do not", async () => {
      expect((await w.call("priya", "GET", "/api/push/public-key")).json()).toEqual({
        publicKey: "PUBKEY",
      });
      expect((await w.call("admin", "GET", "/api/push/public-key")).statusCode).toBe(403);
      expect((await w.call(null, "GET", "/api/push/public-key")).statusCode).toBe(401);
    });

    it("subscribing stores the device; subscribing again does not duplicate it", async () => {
      expect((await subscribe("priya", 1)).json()).toEqual({ devices: 1 });
      expect((await subscribe("priya", 1)).json()).toEqual({ devices: 1 });
      expect((await subscribe("priya", 2)).json()).toEqual({ devices: 2 });
      expect((await w.call("priya", "GET", "/api/reminders/mine")).json()).toMatchObject({
        pushAvailable: true,
        devices: 2,
      });
    });

    it("a device that signs in as someone else moves to that person", async () => {
      await subscribe("priya", 1);
      await subscribe("rohan", 1);
      expect(await devices("priya")).toBe(0);
      expect(await devices("rohan")).toBe(1);
    });

    it("unsubscribing removes only your own device", async () => {
      await subscribe("priya", 1);
      await w.call("rohan", "POST", "/api/push/unsubscribe", { endpoint: sub(1).endpoint });
      expect(await devices("priya")).toBe(1);
      const res = await w.call("priya", "POST", "/api/push/unsubscribe", {
        endpoint: sub(1).endpoint,
      });
      expect(res.json()).toEqual({ devices: 0 });
      expect(await devices("priya")).toBe(0);
    });

    it("rejects a malformed subscription and admins", async () => {
      expect(
        (await w.call("priya", "POST", "/api/push/subscribe", { endpoint: "nope" })).statusCode,
      ).toBe(422);
      expect((await subscribe("admin", 1)).statusCode).toBe(403);
    });

    it("the test push reaches every device, and says so when there is none", async () => {
      expect((await w.call("priya", "POST", "/api/push/test")).statusCode).toBe(409);
      await subscribe("priya", 1);
      await subscribe("priya", 2);
      const res = await w.call("priya", "POST", "/api/push/test");
      expect(res.json()).toMatchObject({ sent: 2, failed: 0 });
      expect(sent.map((s) => s.endpoint).sort()).toEqual([sub(1).endpoint, sub(2).endpoint]);
    });

    it("a device the push service reports gone (410) is forgotten", async () => {
      await subscribe("priya", 1);
      await subscribe("priya", 2);
      failures.set(sub(1).endpoint, 410);
      const res = await w.call("priya", "POST", "/api/push/test");
      expect(res.json()).toMatchObject({ sent: 1, failed: 1 });
      expect(await devices("priya")).toBe(1);
    });

    it("a temporary failure keeps the device", async () => {
      await subscribe("priya", 1);
      failures.set(sub(1).endpoint, 500);
      expect((await w.call("priya", "POST", "/api/push/test")).statusCode).toBe(409);
      expect(await devices("priya")).toBe(1);
    });
  });

  describe("daily reminders by push", () => {
    beforeEach(async () => {
      await db().update(leads).set({ followUpDate: null });
      await db()
        .update(leads)
        .set({ status: "QUALIFIED", ownerId: w.uid.priya as string, followUpDate: day(-1) })
        .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
      await db()
        .update(leads)
        .set({ status: "CONTACTED", ownerId: w.uid.rohan as string, followUpDate: day(0) })
        .where(eq(leads.id, w.lid["Dev Patel"] as string));
    });
    const run = () =>
      runReminders(db(), new PushProvider(notifier), {
        kind: "SCHEDULED",
        timeZone: "Asia/Kolkata",
      });

    it("notifies employees who turned notifications on, and needs no phone number", async () => {
      await subscribe("priya", 1);
      const r = await run();
      expect(r).toMatchObject({ sent: 1, failed: 0 });
      expect(r.noPhone).toEqual(["Rohan Verma"]); // due follow-up, but no device registered
      expect(sent).toHaveLength(1);
      expect(sent[0]?.payload).toMatchObject({
        title: "Follow-ups due: 1 follow-up",
        url: "/app/follow-ups",
      });
      expect(sent[0]?.payload.body).toContain("Aarav Mehta (overdue)");
      const log = await db().select().from(reminderLog);
      expect(log).toMatchObject([{ provider: "push", status: "SENT" }]);
    });

    it("an employee without a device is skipped without using up the day", async () => {
      await run();
      expect(await db().select().from(reminderLog)).toHaveLength(0);
      await subscribe("rohan", 1);
      expect((await run()).sent).toBe(1);
    });

    it("runs once a day per employee, and records a failure as FAILED", async () => {
      await subscribe("priya", 1);
      expect((await run()).sent).toBe(1);
      expect((await run()).alreadySent).toBe(1);
      await db().delete(reminderLog);
      failures.set(sub(1).endpoint, 500);
      expect(await run()).toMatchObject({ sent: 0, failed: 1 });
    });

    it("the admin sees who can be reached", async () => {
      await subscribe("priya", 1);
      const res = (await w.call("admin", "GET", "/api/reminders/due")).json();
      expect(res.provider).toBe("push");
      const by = Object.fromEntries(
        res.employees.map((e: { name: string; reachable: boolean }) => [e.name, e.reachable]),
      );
      expect(by).toEqual({ "Priya Sharma": true, "Rohan Verma": false });
    });
  });

  describe("lead assigned", () => {
    it("tells the employee when the admin assigns a lead, and not when nothing changed", async () => {
      await subscribe("anita", 1);
      await db()
        .update(leads)
        .set({ ownerId: null })
        .where(eq(leads.id, w.lid["Kabir Singh"] as string));
      const body = { ownerId: w.uid.anita };
      const url = `/api/leads/${w.lid["Kabir Singh"]}/assign`;
      expect((await w.call("admin", "POST", url, body)).statusCode).toBe(200);
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.payload).toMatchObject({ title: "New lead assigned", url: "/app/leads" });
      expect(sent[0]?.payload.body).toBe("Kabir Singh");
      await w.call("admin", "POST", url, body);
      await flush();
      expect(sent).toHaveLength(1);
    });

    it("tells the employee how many leads an upload gave them", async () => {
      await subscribe("anita", 1);
      const res = await w.call("admin", "POST", "/api/leads/upload", {
        csv: "phone\n9844400001\n9844400002",
        mode: "owner",
        ownerId: w.uid.anita,
      });
      expect(res.statusCode).toBe(200);
      await flush();
      expect(sent.map((s) => s.payload.title)).toEqual(["2 new leads assigned"]);
    });

    it("a failing push service never fails the assignment", async () => {
      await subscribe("anita", 1);
      failures.set(sub(1).endpoint, 500);
      const res = await w.call("admin", "POST", "/api/leads/upload", {
        csv: "phone\n9844400003",
        mode: "owner",
        ownerId: w.uid.anita,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
