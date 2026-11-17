import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createTestApp, loginCookie, type TestApp } from "../test/app.js";

describe.skipIf(!hasDb)("role guard", () => {
  let ctx: TestApp;
  beforeAll(async () => {
    ctx = await createTestApp({}, (app) => {
      app.get("/api/_probe/admin", { preHandler: app.guard("ADMIN") }, async () => ({ ok: true }));
      app.get("/api/_probe/employee", { preHandler: app.guard("EMPLOYEE") }, async () => ({
        ok: true,
      }));
      app.get("/api/_probe/any", { preHandler: app.guard() }, async () => ({ ok: true }));
    });
  });
  afterAll(() => ctx.close());

  const get = (url: string, cookie?: string) =>
    ctx.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

  it("lets an admin onto admin routes", async () => {
    const { cookie } = await loginCookie(ctx.app, "admin@demo.com");
    expect((await get("/api/_probe/admin", cookie)).statusCode).toBe(200);
  });

  it("gives an employee 403 on admin routes", async () => {
    const { cookie } = await loginCookie(ctx.app, "priya@demo.com");
    const res = await get("/api/_probe/admin", cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("gives an admin 403 on employee-only routes", async () => {
    const { cookie } = await loginCookie(ctx.app, "admin@demo.com");
    expect((await get("/api/_probe/employee", cookie)).statusCode).toBe(403);
    expect(
      (await get("/api/_probe/employee", (await loginCookie(ctx.app, "priya@demo.com")).cookie))
        .statusCode,
    ).toBe(200);
  });

  it("gives 401, not 403, when not signed in", async () => {
    for (const url of ["/api/_probe/admin", "/api/_probe/employee", "/api/_probe/any"]) {
      expect((await get(url)).statusCode).toBe(401);
    }
  });

  it("allows any signed-in role on an unrestricted guard", async () => {
    for (const email of ["admin@demo.com", "rohan@demo.com"]) {
      const { cookie } = await loginCookie(ctx.app, email);
      expect((await get("/api/_probe/any", cookie)).statusCode).toBe(200);
    }
  });

  it("rejects an inactive user holding a valid token, on every kind of route", async () => {
    const { cookie } = await loginCookie(ctx.app, "admin@demo.com");
    await ctx.t.db.update(users).set({ isActive: false }).where(eq(users.email, "admin@demo.com"));
    for (const url of ["/api/_probe/admin", "/api/_probe/any", "/api/auth/me"]) {
      expect((await get(url, cookie)).statusCode).toBe(401);
    }
    await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.email, "admin@demo.com"));
  });

  it("reads the role from the database, not the token", async () => {
    const { cookie } = await loginCookie(ctx.app, "rohan@demo.com");
    expect((await get("/api/_probe/admin", cookie)).statusCode).toBe(403);
    await ctx.t.db.update(users).set({ role: "ADMIN" }).where(eq(users.email, "rohan@demo.com"));
    expect((await get("/api/_probe/admin", cookie)).statusCode).toBe(200);
    await ctx.t.db.update(users).set({ role: "EMPLOYEE" }).where(eq(users.email, "rohan@demo.com"));
    expect((await get("/api/_probe/admin", cookie)).statusCode).toBe(403);
  });
});
