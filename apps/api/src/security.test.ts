import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb } from "./test/db.js";
import { TEST_PASSWORD, createTestApp, type TestApp } from "./test/app.js";

describe.skipIf(!hasDb)("login rate limiting", () => {
  let ctx: TestApp;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const login = (
    email: string,
    password: string,
    ip = "10.0.0.1",
    headers: Record<string, string> = {},
  ) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: ip,
      headers,
      payload: { email, password },
    });

  it("returns 429 with Retry-After after repeated bad logins, even for the right password", async () => {
    for (let i = 0; i < 5; i++)
      expect((await login("priya@demo.com", "wrong-pass", "10.0.1.1")).statusCode).toBe(401);
    const blocked = await login("priya@demo.com", "wrong-pass", "10.0.1.1");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // Correct password is also refused while blocked: no oracle for guessing.
    expect((await login("priya@demo.com", TEST_PASSWORD, "10.0.1.1")).statusCode).toBe(429);
  });

  it("does not block other accounts from the same IP, or the same account from another IP", async () => {
    expect((await login("rohan@demo.com", TEST_PASSWORD, "10.0.1.1")).statusCode).toBe(200);
    expect((await login("priya@demo.com", TEST_PASSWORD, "10.0.9.9")).statusCode).toBe(200);
  });

  it("counts failures only: successful logins never trip the limit", async () => {
    for (let i = 0; i < 15; i++)
      expect((await login("admin@demo.com", TEST_PASSWORD, "10.0.2.1")).statusCode).toBe(200);
  });

  it("resets the account counter after a successful login", async () => {
    for (let i = 0; i < 4; i++) await login("anita@demo.com", "bad-bad-bad", "10.0.3.1");
    expect((await login("anita@demo.com", TEST_PASSWORD, "10.0.3.1")).statusCode).toBe(200);
    for (let i = 0; i < 4; i++)
      expect((await login("anita@demo.com", "bad-bad-bad", "10.0.3.1")).statusCode).toBe(401);
  });

  it("caps one IP guessing across many accounts", async () => {
    for (let i = 0; i < 20; i++)
      expect((await login(`ghost${i}@demo.com`, "x-x-x-x", "10.0.4.1")).statusCode).toBe(401);
    expect((await login("ghost99@demo.com", "x-x-x-x", "10.0.4.1")).statusCode).toBe(429);
    expect((await login("admin@demo.com", TEST_PASSWORD, "10.0.4.1")).statusCode).toBe(429);
  });

  it("ignores X-Forwarded-For unless TRUST_PROXY is on, so it cannot be used to dodge the limit", async () => {
    for (let i = 0; i < 5; i++)
      await login("rohan@demo.com", "bad-bad-bad", "10.0.5.1", { "x-forwarded-for": `1.2.3.${i}` });
    const res = await login("rohan@demo.com", "bad-bad-bad", "10.0.5.1", {
      "x-forwarded-for": "9.9.9.9",
    });
    expect(res.statusCode).toBe(429);
  });

  it("validation errors (422) are not counted as failures", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "10.0.6.1",
        payload: {},
      });
      expect(res.statusCode).toBe(422);
    }
    expect((await login("admin@demo.com", TEST_PASSWORD, "10.0.6.1")).statusCode).toBe(200);
  });
});

describe.skipIf(!hasDb)("limits honour TRUST_PROXY=true", () => {
  let ctx: TestApp;
  beforeAll(async () => {
    ctx = await createTestApp({ TRUST_PROXY: "true" });
  });
  afterAll(() => ctx.close());

  it("buckets by the forwarded client address", async () => {
    const attempt = (xff: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "10.9.9.9",
        headers: { "x-forwarded-for": xff },
        payload: { email: "priya@demo.com", password: "bad-bad-bad" },
      });
    for (let i = 0; i < 5; i++) await attempt("203.0.113.5");
    expect((await attempt("203.0.113.5")).statusCode).toBe(429);
    expect((await attempt("203.0.113.6")).statusCode).toBe(401); // different real client
  });
});

describe.skipIf(!hasDb)("security headers and CORS", () => {
  let ctx: TestApp;
  beforeAll(async () => {
    ctx = await createTestApp({ CORS_ORIGIN: "http://localhost:5173, https://app.example.com" });
  });
  afterAll(() => ctx.close());

  it("sets hardening headers and hides the framework", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it.each(["http://localhost:5173", "https://app.example.com"])(
    "allows credentialed requests from %s",
    async (origin) => {
      const res = await ctx.app.inject({
        method: "OPTIONS",
        url: "/api/auth/login",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    },
  );

  it("does not grant CORS to other origins", async () => {
    const pre = await ctx.app.inject({
      method: "OPTIONS",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    const get = await ctx.app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" },
    });
    expect(get.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
