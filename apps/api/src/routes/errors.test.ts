import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestLogShape } from "../app.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

/** Every failure, whatever its cause, has the same body: { error: { code, message, details? } } and leaks nothing. */
describe.skipIf(!hasDb)("error format and input validation (10.3)", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w.ctx.close();
  });

  const shape = (res: { statusCode: number; json: () => unknown; body: string }) => {
    const body = res.json() as { error?: { code?: string; message?: string } };
    expect(body.error, res.body).toBeDefined();
    expect(typeof body.error?.code).toBe("string");
    expect(typeof body.error?.message).toBe("string");
    expect(Object.keys(body)).toEqual(["error"]);
    expect(res.body).not.toMatch(
      /node_modules|\.ts:\d|at async|SELECT |INSERT |password_hash|argon2|JWT_SECRET/i,
    );
    return body.error as { code: string; message: string; details?: unknown };
  };
  const raw = (
    method: "POST" | "PATCH" | "PUT",
    url: string,
    body: string,
    ct = "application/json",
    as = "admin",
  ) =>
    w.ctx.app.inject({
      method,
      url,
      headers: { cookie: w.cookies[as] as string, "content-type": ct },
      payload: body,
    });

  it.each([
    [401, () => w.call(null, "GET", "/api/leads"), "UNAUTHORIZED"],
    [403, () => w.call("priya", "GET", "/api/users"), "FORBIDDEN"],
    [
      404,
      () => w.call("admin", "GET", "/api/leads/00000000-0000-4000-8000-000000000000"),
      "NOT_FOUND",
    ],
    [404, () => w.call("admin", "GET", "/api/no-such-route"), "NOT_FOUND"],
    [422, () => w.call("admin", "POST", "/api/users", {}), "VALIDATION_ERROR"],
    [422, () => w.call("admin", "GET", "/api/leads?page=0"), "VALIDATION_ERROR"],
  ])("%i has the standard shape (%#)", async (status, send, code) => {
    const res = await send();
    expect(res.statusCode).toBe(status);
    expect(shape(res).code).toBe(code);
  });

  it("validation errors say which field and why, without echoing the submitted value", async () => {
    const res = await w.call("admin", "POST", "/api/users", {
      name: "x",
      email: "secret-looking-value",
      phone: "1",
    });
    const err = shape(res);
    const details = err.details as { path: string; message: string }[];
    expect(details.map((d) => d.path)).toContain("email");
    expect(JSON.stringify(res.json())).not.toContain("secret-looking-value");
  });

  describe("malformed input never becomes a 500", () => {
    it("invalid JSON is a 400 in the standard shape", async () => {
      const res = await raw(
        "POST",
        "/api/leads/" + w.lid["Aarav Mehta"] + "/notes",
        "{not json",
        "application/json",
        "priya",
      );
      expect(res.statusCode).toBe(400);
      shape(res);
    });
    it("a wrong content type is a client error, not a crash", async () => {
      const res = await raw("POST", "/api/users", "name=x", "application/x-www-form-urlencoded");
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      shape(res);
    });
    it.each([
      ["null"],
      ["[]"],
      ['"text"'],
      ["123"],
      ['{"__proto__":{"role":"ADMIN"}}'],
      ['{"constructor":{"prototype":{"x":1}}}'],
    ])("body %s is rejected cleanly", async (body) => {
      const res = await raw("POST", "/api/users", body);
      expect([400, 422]).toContain(res.statusCode);
      shape(res);
      expect(({} as { role?: string }).role).toBeUndefined(); // no prototype pollution
    });
    it.each([
      "?page=abc",
      "?page=-1",
      "?pageSize=100000",
      "?status=NOPE",
      "?owner=not-a-uuid",
      "?search=" + "x".repeat(500),
      "?stale=maybe",
    ])("list query %s is a 422", async (q) => {
      const res = await w.call("admin", "GET", "/api/leads" + q);
      expect(res.statusCode).toBe(422);
      shape(res);
    });
    it("SQL metacharacters in search are data, not SQL", async () => {
      const res = await w.call(
        "admin",
        "GET",
        `/api/leads?search=${encodeURIComponent("'; DROP TABLE leads; --")}`,
      );
      expect(res.statusCode).toBe(200);
      expect((await w.call("admin", "GET", "/api/leads")).statusCode).toBe(200); // table still there
    });
    it("LIKE wildcards in search are literal", async () => {
      const all = (await w.call("admin", "GET", "/api/leads?pageSize=100")).json().leads.length;
      const pct = (
        await w.call("admin", "GET", `/api/leads?search=${encodeURIComponent("%")}`)
      ).json().leads.length;
      expect(pct).toBeLessThan(all);
    });
    it("a note over the length limit and a blank note are 422", async () => {
      const id = w.lid["Aarav Mehta"];
      expect(
        (await w.call("priya", "POST", `/api/leads/${id}/notes`, { text: "x".repeat(2001) }))
          .statusCode,
      ).toBe(422);
      expect(
        (await w.call("priya", "POST", `/api/leads/${id}/notes`, { text: "   " })).statusCode,
      ).toBe(422);
    });
    it("a lead name with markup is stored and returned as plain text (the UI escapes it)", async () => {
      const csv = 'name,company,phone,source\n"<img src=x onerror=alert(1)>",Co,9876501234,Web';
      const up = await w.call("admin", "POST", "/api/leads/upload", { csv, mode: "none" });
      expect(up.statusCode).toBe(200);
      const list = (await w.call("admin", "GET", "/api/leads?search=img")).json().leads;
      expect(list[0].name).toBe("<img src=x onerror=alert(1)>");
    });
    it("a body over the default limit is refused with 413 on ordinary routes", async () => {
      const res = await raw("POST", "/api/users", JSON.stringify({ name: "x".repeat(1_200_000) }));
      expect(res.statusCode).toBe(413);
      shape(res);
    });
    it("a CSV over 5 MB is refused before it is parsed", async () => {
      const res = await w.call("admin", "POST", "/api/leads/upload", {
        csv: "a".repeat(5 * 1024 * 1024 + 1),
        mode: "none",
      });
      expect([413, 422]).toContain(res.statusCode);
      shape(res);
    });
  });

  it("an unexpected server error is a generic 500 that reveals nothing", async () => {
    const { createTestApp } = await import("../test/app.js");
    const ctx = await createTestApp({}, (app) => {
      app.get("/boom", async () => {
        throw new Error("secret internal detail: postgres://user:pass@host/db");
      });
    });
    try {
      const res = await ctx.app.inject({ method: "GET", url: "/boom" });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(res.body).not.toContain("postgres://");
    } finally {
      await ctx.close();
    }
  });
});

describe("request logging", () => {
  it("drops the query string so search terms and phone numbers are not logged", () => {
    expect(
      requestLogShape({
        method: "GET",
        url: "/api/leads?search=Aarav%20Mehta&owner=x",
        ip: "1.2.3.4",
      }),
    ).toEqual({
      method: "GET",
      url: "/api/leads",
      remoteAddress: "1.2.3.4",
    });
    expect(requestLogShape({ method: "GET", url: "/health" }).url).toBe("/health");
  });
});
