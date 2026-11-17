import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activities, leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

/**
 * Authorization matrix (10.2). Every route the app registers must appear here with
 * who may call it. The completeness test fails when a route is added without a rule,
 * so access control cannot be forgotten.
 *
 *   any      signed-in admin or employee
 *   admin    admin only            (employee -> 403)
 *   employee employee only        (admin -> 403)
 *
 * Denied callers must get 401 (no session) or 403 (wrong role) BEFORE any validation or
 * work happens; allowed callers must get anything but 401/403 (often 422 for the
 * deliberately empty payload, so nothing is changed).
 */
type Access = "any" | "admin" | "employee";
const RULES: Record<string, Access> = {
  "GET /api/auth/me": "any",
  "POST /api/auth/change-password": "any",
  "GET /api/activity": "admin",
  "GET /api/settings": "admin",
  "PUT /api/settings": "admin",
  "GET /api/stats/overview": "admin",
  "GET /api/stats/team": "admin",
  "GET /api/stats/stale": "admin",
  "GET /api/stats/lost-reasons": "admin",
  "GET /api/users": "admin",
  "POST /api/users": "admin",
  "POST /api/users/:id/deactivate": "admin",
  "POST /api/users/:id/reactivate": "admin",
  "GET /api/leads": "any",
  "GET /api/leads/:id": "any",
  "GET /api/leads/summary": "employee",
  "POST /api/leads/upload": "admin",
  "POST /api/leads/auto-assign": "admin",
  "POST /api/leads/:id/assign": "admin",
  "PATCH /api/leads/:id/status": "employee",
  "PATCH /api/leads/:id/follow-up": "employee",
  "POST /api/leads/:id/calls": "employee",
  "POST /api/leads/:id/notes": "employee",
  "POST /api/leads/:id/contact-events": "employee",
  "GET /api/reminders/due": "admin",
  "GET /api/reminders/log": "admin",
  "POST /api/reminders/send-now": "admin",
  "GET /api/reminders/mine": "employee",
};
/** Reachable without a session on purpose. */
const PUBLIC = ["POST /api/auth/login", "POST /api/auth/logout", "GET /health"];
/** Not routes of the application proper. */
const IGNORED = ["OPTIONS *"];

describe.skipIf(!hasDb)("authorization matrix (10.2)", () => {
  let w: World;
  const routes: string[] = [];
  const own: Record<string, string> = {};

  beforeAll(async () => {
    w = await createWorld(
      {},
      {
        beforeReady: (app) =>
          app.addHook("onRoute", (r) => {
            for (const m of [r.method].flat()) if (m !== "HEAD") routes.push(`${m} ${r.url}`);
          }),
      },
    );
    own.leadId = w.lid["Aarav Mehta"] as string; // Priya's
    own.userId = w.uid.anita as string;
  });
  afterAll(async () => {
    await w.ctx.close();
  });

  const fill = (url: string) =>
    url.replace(":id", url.includes("/users/") ? own.userId! : own.leadId!);
  const method = (k: string) => k.split(" ")[0] as "GET" | "POST" | "PATCH" | "PUT";
  const url = (k: string) => fill(k.split(" ")[1]!);
  const bad = (m: string) => (m === "GET" ? undefined : {}); // empty payload: harmless if it gets through

  it("every registered route has a rule (nothing is unguarded by accident)", () => {
    const known = new Set([...Object.keys(RULES), ...PUBLIC, ...IGNORED]);
    expect(routes.filter((r) => !known.has(r))).toEqual([]);
    // and the table has no stale entries
    expect(Object.keys(RULES).filter((r) => !routes.includes(r))).toEqual([]);
  });

  describe.each(Object.entries(RULES))("%s", (key, access) => {
    it("401 with no session", async () => {
      expect((await w.call(null, method(key), url(key), bad(method(key)))).statusCode).toBe(401);
    });
    it("rejects a forged or malformed session cookie with 401", async () => {
      for (const cookie of [
        "lb_session=garbage",
        "lb_session=",
        `${w.cookies.admin!.slice(0, -3)}abc`,
      ]) {
        const res = await w.ctx.app.inject({
          method: method(key),
          url: url(key),
          headers: { cookie },
          payload: bad(method(key)) as object,
        });
        expect(res.statusCode).toBe(401);
      }
    });
    if (access === "admin") {
      it("employee gets 403", async () => {
        const res = await w.call("priya", method(key), url(key), bad(method(key)));
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toMatch(/stack|at .*\.ts/);
      });
    }
    if (access === "employee") {
      it("admin gets 403", async () => {
        expect((await w.call("admin", method(key), url(key), bad(method(key)))).statusCode).toBe(
          403,
        );
      });
    }
  });

  it("public routes need no session", async () => {
    expect((await w.call(null, "GET", "/health")).statusCode).toBe(200);
    expect((await w.call(null, "POST", "/api/auth/login", {})).statusCode).toBe(422); // reached the handler
    // logout is idempotent: with or without a session it only clears the cookie
    expect((await w.call(null, "POST", "/api/auth/logout", {})).statusCode).toBe(200);
  });

  it("allowed callers are not turned away (admin on admin/any routes, employee on employee/any routes)", async () => {
    for (const [key, access] of Object.entries(RULES)) {
      if (
        key.includes("/deactivate") ||
        key.includes("send-now") ||
        key.includes("auto-assign") ||
        key.includes("change-password")
      )
        continue; // state-changing: covered by their own suites
      const as = access === "employee" ? "priya" : "admin";
      const res = await w.call(as, method(key), url(key), bad(method(key)));
      expect([401, 403], `${as} ${key} -> ${res.statusCode}`).not.toContain(res.statusCode);
    }
  });

  describe("employee A against employee B's lead (IDOR)", () => {
    const rohanLead = () => w.lid["Ravi Kumar"] as string; // resolved below to a real Rohan lead
    let target: string;
    let before: { status: string; followUp: string | null; ownerId: string | null; acts: number };
    const snapshot = async (id: string) => {
      const l = (await w.ctx.t.db.select().from(leads).where(eq(leads.id, id)))[0]!;
      const acts = (await w.ctx.t.db.select().from(activities).where(eq(activities.leadId, id)))
        .length;
      return { status: l.status, followUp: l.followUpDate, ownerId: l.ownerId, acts };
    };
    beforeAll(async () => {
      const mine = await w.ctx.t.db
        .select()
        .from(leads)
        .where(eq(leads.ownerId, w.uid.rohan as string));
      target = mine[0]!.id;
      before = await snapshot(target);
      void rohanLead;
    });

    const attempts: [string, "GET" | "POST" | "PATCH", string, object | undefined][] = [
      ["read", "GET", "", undefined],
      ["change status", "PATCH", "/status", { status: "WON" }],
      ["mark lost", "PATCH", "/status", { status: "LOST", lostReason: "PRICE" }],
      ["log a call", "POST", "/calls", { outcome: "ANSWERED" }],
      ["add a note", "POST", "/notes", { text: "intruder" }],
      ["set follow-up", "PATCH", "/follow-up", { date: "2031-01-01" }],
      ["log contact event", "POST", "/contact-events", { kind: "CALL" }],
    ];
    it.each(attempts)(
      "cannot %s: same 404 as a lead that does not exist",
      async (_n, m, suffix, payload) => {
        const foreign = await w.call("priya", m, `/api/leads/${target}${suffix}`, payload);
        const missing = await w.call(
          "priya",
          m,
          `/api/leads/00000000-0000-4000-8000-000000000000${suffix}`,
          payload,
        );
        expect(foreign.statusCode).toBe(404);
        expect(foreign.json()).toEqual(missing.json());
      },
    );
    it("cannot assign or reassign (admin only), and nothing about the lead changed", async () => {
      const res = await w.call("priya", "POST", `/api/leads/${target}/assign`, {
        ownerId: w.uid.priya,
      });
      expect(res.statusCode).toBe(403);
      expect(await snapshot(target)).toEqual(before);
    });
    it("does not see the lead in lists, search or filters, even by asking for it", async () => {
      const name = (await w.ctx.t.db.select().from(leads).where(eq(leads.id, target)))[0]!.name;
      for (const q of [
        `?search=${encodeURIComponent(name)}`,
        `?owner=${w.uid.rohan}`,
        "?owner=none",
        "?pageSize=100",
      ]) {
        const res = await w.call("priya", "GET", `/api/leads${q}`);
        const ids = (res.json().leads ?? []).map((l: { id: string }) => l.id);
        expect(ids, q).not.toContain(target);
      }
    });
    it("a non-uuid id is rejected without touching the database", async () => {
      expect([404, 422]).toContain(
        (await w.call("priya", "GET", "/api/leads/not-a-uuid")).statusCode,
      );
      expect([404, 422]).toContain(
        (await w.call("priya", "GET", "/api/leads/1%27%20OR%20%271%27=%271")).statusCode,
      );
    });
  });

  describe("sessions", () => {
    it("a deactivated user's existing session stops working immediately", async () => {
      await w.call("admin", "POST", `/api/users/${w.uid.anita}/deactivate`);
      expect((await w.call("anita", "GET", "/api/leads")).statusCode).toBe(401);
      await w.call("admin", "POST", `/api/users/${w.uid.anita}/reactivate`);
    });
    it("a role change in the database is honoured on the next request (the token is not trusted for role)", async () => {
      await w.ctx.t.db
        .update(users)
        .set({ role: "EMPLOYEE" })
        .where(eq(users.id, w.uid.rohan as string));
      expect((await w.call("rohan", "GET", "/api/users")).statusCode).toBe(403);
    });
  });
});
