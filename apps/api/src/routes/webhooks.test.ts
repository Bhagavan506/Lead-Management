import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leads, reminderLog } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { startFakeMeta } from "../test/fake-meta.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";
import { runReminders } from "../services/reminders.js";

const SECRET = "app-secret-for-tests";
const VERIFY = "verify-token-for-tests";
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const statusBody = (...events: { id: string; status: string; errors?: unknown[] }[]) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              statuses: events.map((e) => ({ recipient_id: "919820000001", timestamp: "1", ...e })),
            },
          },
        ],
      },
    ],
  });

describe.skipIf(!hasDb)(
  "Meta provider + delivery webhook, end to end against a simulated Meta API (9.4)",
  () => {
    let w: World;
    let fake: Awaited<ReturnType<typeof startFakeMeta>>;
    const db = () => w.ctx.t.db;
    const post = (
      body: string,
      headers: Record<string, string> = { "x-hub-signature-256": sign(body) },
    ) =>
      w.ctx.app.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: { "content-type": "application/json", ...headers },
        payload: body,
      });
    const statusOf = async (id: string) =>
      (await db().select().from(reminderLog).where(eq(reminderLog.providerMessageId, id)))[0]
        ?.status;
    const seedRow = (id: string, status: string) =>
      db()
        .insert(reminderLog)
        .values({
          employeeId: w.uid.priya as string,
          date: dateInTz("Asia/Kolkata"),
          kind: "MANUAL",
          messageText: "x",
          provider: "meta",
          providerMessageId: id,
          status,
        });

    beforeAll(async () => {
      fake = await startFakeMeta();
      w = await createWorld(
        {
          WHATSAPP_PROVIDER: "meta",
          WHATSAPP_PHONE_NUMBER_ID: "555",
          WHATSAPP_ACCESS_TOKEN: "tok",
          WHATSAPP_TEMPLATE_NAME: "follow_up_reminder",
          WHATSAPP_APP_SECRET: SECRET,
          WHATSAPP_VERIFY_TOKEN: VERIFY,
          WHATSAPP_API_BASE: fake.base,
        },
        { realProvider: true },
      );
    });
    afterAll(async () => {
      await w.ctx.close();
      await fake.close();
    });
    beforeEach(async () => {
      await db().delete(reminderLog);
      fake.requests.length = 0;
    });

    describe("end to end: job -> Meta -> webhook", () => {
      it("sends through the Meta provider, stores Meta's message id, then follows sent -> delivered -> read", async () => {
        await db().update(leads).set({ followUpDate: null });
        await db()
          .update(leads)
          .set({
            status: "QUALIFIED",
            ownerId: w.uid.priya as string,
            followUpDate: dateInTz("Asia/Kolkata", -1),
          })
          .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
        const summary = await runReminders(db(), w.ctx.app.whatsapp, {
          kind: "SCHEDULED",
          timeZone: "Asia/Kolkata",
        });
        expect(summary).toMatchObject({ sent: 1, failed: 0 });
        expect(fake.requests).toHaveLength(1);
        expect(fake.requests[0]!.body.template.components[0].parameters[2].text).toBe(
          "Aarav Mehta (overdue)",
        );
        const row = (await db().select().from(reminderLog))[0]!;
        expect(row).toMatchObject({ provider: "meta", status: "SENT" });
        const id = row.providerMessageId as string;
        expect(id).toMatch(/^wamid\./);

        expect((await post(statusBody({ id, status: "delivered" }))).json()).toEqual({
          received: 1,
          updated: 1,
        });
        expect(await statusOf(id)).toBe("DELIVERED");
        await post(statusBody({ id, status: "read" }));
        expect(await statusOf(id)).toBe("READ");
      });

      it("a rejected send is stored as FAILED (the daily job does not retry it)", async () => {
        fake.reply = () => ({
          status: 400,
          json: { error: { message: "template not approved", code: 132001 } },
        });
        const summary = await runReminders(db(), w.ctx.app.whatsapp, {
          kind: "MANUAL",
          timeZone: "Asia/Kolkata",
        });
        expect(summary.failed).toBeGreaterThan(0);
        expect(
          (await db().select().from(reminderLog)).every(
            (r) => r.status === "FAILED" && r.provider === "meta",
          ),
        ).toBe(true);
        fake.reply = () => ({ status: 200, json: { messages: [{ id: "wamid.OK" }] } });
      });
    });

    describe("signature verification (the only protection on a public endpoint)", () => {
      it("accepts a correctly signed request and updates the message", async () => {
        await seedRow("wamid.S1", "SENT");
        const res = await post(statusBody({ id: "wamid.S1", status: "delivered" }));
        expect(res.statusCode).toBe(200);
        expect(await statusOf("wamid.S1")).toBe("DELIVERED");
      });

      it.each([
        ["no signature header", {}],
        ["wrong secret", "wrong"],
        ["missing sha256= prefix", "raw"],
        ["empty signature", ""],
        ["garbage signature", "sha256=zzzz"],
        ["signature of a different body", "other"],
      ])("rejects %s with 401 and changes nothing", async (_n, kind) => {
        await seedRow("wamid.S2", "SENT");
        const body = statusBody({ id: "wamid.S2", status: "read" });
        const headers: Record<string, string> =
          kind === "wrong"
            ? { "x-hub-signature-256": sign(body, "not-the-secret") }
            : kind === "raw"
              ? { "x-hub-signature-256": createHmac("sha256", SECRET).update(body).digest("hex") }
              : kind === "other"
                ? { "x-hub-signature-256": sign("{}") }
                : typeof kind === "string"
                  ? { "x-hub-signature-256": kind }
                  : {};
        const res = await post(body, headers);
        expect(res.statusCode).toBe(401);
        expect(await statusOf("wamid.S2")).toBe("SENT");
      });

      it("rejects a body that was altered after signing", async () => {
        await seedRow("wamid.S3", "SENT");
        const signed = statusBody({ id: "wamid.S3", status: "delivered" });
        const tampered = signed.replace("delivered", "read");
        expect((await post(tampered, { "x-hub-signature-256": sign(signed) })).statusCode).toBe(
          401,
        );
        expect(await statusOf("wamid.S3")).toBe("SENT");
      });

      it("signature is checked against the exact bytes (whitespace changes break it)", async () => {
        await seedRow("wamid.S4", "SENT");
        const body = statusBody({ id: "wamid.S4", status: "delivered" });
        expect((await post(` ${body}`, { "x-hub-signature-256": sign(body) })).statusCode).toBe(
          401,
        );
      });

      it("an unsigned empty body is rejected before any parsing", async () => {
        expect((await post("{}", {})).statusCode).toBe(401);
        expect((await post("not json", {})).statusCode).toBe(401);
      });

      it("a signed body that is not JSON is a 400, not a crash", async () => {
        const res = await post("not json", { "x-hub-signature-256": sign("not json") });
        expect(res.statusCode).toBe(400);
      });
    });

    describe("status handling", () => {
      it("never moves a message backwards (late or repeated webhooks)", async () => {
        await seedRow("wamid.R1", "READ");
        await post(statusBody({ id: "wamid.R1", status: "delivered" }));
        await post(statusBody({ id: "wamid.R1", status: "sent" }));
        expect(await statusOf("wamid.R1")).toBe("READ");
        const again = await post(statusBody({ id: "wamid.R1", status: "read" }));
        expect(again.json()).toEqual({ received: 1, updated: 0 });
      });

      it("failed replaces SENT but never a delivered or read message", async () => {
        await seedRow("wamid.F1", "SENT");
        await seedRow("wamid.F2", "DELIVERED");
        await seedRow("wamid.F3", "READ");
        await post(
          statusBody(
            {
              id: "wamid.F1",
              status: "failed",
              errors: [{ code: 131026, title: "Message undeliverable" }],
            },
            { id: "wamid.F2", status: "failed" },
            { id: "wamid.F3", status: "failed" },
          ),
        );
        expect(await statusOf("wamid.F1")).toBe("FAILED");
        expect(await statusOf("wamid.F2")).toBe("DELIVERED");
        expect(await statusOf("wamid.F3")).toBe("READ");
      });

      it("handles several events in one request and ignores unknown ids, unknown statuses and other event types", async () => {
        await seedRow("wamid.M1", "SENT");
        await seedRow("wamid.M2", "SENT");
        const body = statusBody(
          { id: "wamid.M1", status: "delivered" },
          { id: "wamid.M2", status: "read" },
          { id: "wamid.NOPE", status: "delivered" },
          { id: "wamid.M1", status: "mystery" },
        );
        expect((await post(body)).json()).toEqual({ received: 4, updated: 2 });
        expect(await statusOf("wamid.M1")).toBe("DELIVERED");
        expect(await statusOf("wamid.M2")).toBe("READ");
        const incoming = JSON.stringify({
          object: "whatsapp_business_account",
          entry: [
            { changes: [{ value: { messages: [{ from: "91...", text: { body: "hi" } }] } }] },
          ],
        });
        expect((await post(incoming, { "x-hub-signature-256": sign(incoming) })).json()).toEqual({
          received: 0,
          updated: 0,
        });
      });

      it.each([
        [{}],
        [{ entry: "x" }],
        [{ entry: [null] }],
        [{ entry: [{ changes: "no" }] }],
        [{ entry: [{ changes: [{ value: { statuses: "no" } }] }] }],
        [[]],
        [null],
      ])("a signed but oddly shaped payload %j is acknowledged, not an error", async (payload) => {
        const body = JSON.stringify(payload);
        const res = await post(body, { "x-hub-signature-256": sign(body) });
        expect(res.statusCode).toBe(200);
        expect(res.json().updated).toBe(0);
      });

      it("repeating the same webhook is harmless (Meta retries)", async () => {
        await seedRow("wamid.D1", "SENT");
        const body = statusBody({ id: "wamid.D1", status: "delivered" });
        expect((await post(body)).json().updated).toBe(1);
        expect((await post(body)).json().updated).toBe(0);
        expect(await statusOf("wamid.D1")).toBe("DELIVERED");
      });

      it("concurrent webhooks end at the furthest status regardless of order", async () => {
        await seedRow("wamid.C1", "SENT");
        await Promise.all([
          post(statusBody({ id: "wamid.C1", status: "read" })),
          post(statusBody({ id: "wamid.C1", status: "delivered" })),
          post(statusBody({ id: "wamid.C1", status: "sent" })),
        ]);
        expect(await statusOf("wamid.C1")).toBe("READ");
      });
    });

    describe("subscription handshake", () => {
      const verify = (q: string) =>
        w.ctx.app.inject({ method: "GET", url: `/webhooks/whatsapp${q}` });
      it("echoes the challenge for the right token", async () => {
        const res = await verify(
          `?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`,
        );
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe("12345");
        expect(res.headers["content-type"]).toContain("text/plain");
      });
      it.each([
        "?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1",
        `?hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`,
        `?hub.mode=subscribe&hub.verify_token=${VERIFY}`,
        "",
        `?hub.mode=subscribe&hub.verify_token=${VERIFY.slice(0, -1)}&hub.challenge=1`,
      ])("refuses %s", async (q) => {
        const res = await verify(q);
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain("1");
      });
    });

    it("the webhook needs no cookie, and the JSON parser change does not leak into other routes", async () => {
      const res = await w.call("admin", "PUT", "/api/settings", { staleDays: 3 }); // normal JSON route still parses objects
      expect(res.statusCode).toBe(200);
      expect(res.json().staleDays).toBe(3);
      await w.call("admin", "PUT", "/api/settings", { staleDays: 2 });
    });
  },
);

describe.skipIf(!hasDb)("webhook is not exposed in mock mode", () => {
  it("returns 404 for both verification and delivery posts", async () => {
    const w = await createWorld();
    try {
      expect(
        (
          await w.ctx.app.inject({
            method: "GET",
            url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1",
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await w.ctx.app.inject({ method: "POST", url: "/webhooks/whatsapp", payload: {} }))
          .statusCode,
      ).toBe(404);
    } finally {
      await w.ctx.close();
    }
  });
});

describe("config for the meta provider", () => {
  it("refuses to start without the credentials it needs, naming each missing one", async () => {
    const { loadConfig } = await import("../config.js");
    const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40) };
    expect(() => loadConfig({ ...base, WHATSAPP_PROVIDER: "meta" })).toThrow(
      /WHATSAPP_PHONE_NUMBER_ID.*WHATSAPP_ACCESS_TOKEN.*WHATSAPP_TEMPLATE_NAME.*WHATSAPP_APP_SECRET.*WHATSAPP_VERIFY_TOKEN/s,
    );
    expect(() =>
      loadConfig({
        ...base,
        WHATSAPP_PROVIDER: "meta",
        WHATSAPP_PHONE_NUMBER_ID: "1",
        WHATSAPP_ACCESS_TOKEN: "t",
        WHATSAPP_TEMPLATE_NAME: "n",
        WHATSAPP_APP_SECRET: "  ",
        WHATSAPP_VERIFY_TOKEN: "v",
      }),
    ).toThrow(/WHATSAPP_APP_SECRET/);
    expect(
      loadConfig({
        ...base,
        WHATSAPP_PROVIDER: "meta",
        WHATSAPP_PHONE_NUMBER_ID: "1",
        WHATSAPP_ACCESS_TOKEN: "t",
        WHATSAPP_TEMPLATE_NAME: "n",
        WHATSAPP_APP_SECRET: "s",
        WHATSAPP_VERIFY_TOKEN: "v",
      }).WHATSAPP_PROVIDER,
    ).toBe("meta");
    expect(loadConfig({ ...base }).WHATSAPP_PROVIDER).toBe("mock"); // default needs no credentials
  });
});
