import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { TEST_PASSWORD, createTestApp, loginCookie, type TestApp } from "../test/app.js";

describe.skipIf(!hasDb)("forced password change on first login", () => {
  let ctx: TestApp;
  let admin: string;
  beforeAll(async () => {
    ctx = await createTestApp({}, (app) => {
      app.get("/api/_probe/any", { preHandler: app.guard() }, async () => ({ ok: true }));
      app.get("/api/_probe/employee", { preHandler: app.guard("EMPLOYEE") }, async () => ({
        ok: true,
      }));
    });
    admin = (await loginCookie(ctx.app, "admin@demo.com")).cookie;
  });
  afterAll(() => ctx.close());

  const NEW_PW = "A-brand-new-secret-9";
  const newEmployee = async (email: string) => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: admin },
      payload: { name: "New Person", email, phone: "9000011122" },
    });
    return res.json().temporaryPassword as string;
  };
  const get = (url: string, cookie: string) =>
    ctx.app.inject({ method: "GET", url, headers: { cookie } });
  const change = (cookie: string, payload: object) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload,
    });

  it("blocks every route except me, logout and change-password until the password is changed", async () => {
    const temp = await newEmployee("first@example.com");
    const { cookie, res } = await loginCookie(ctx.app, "first@example.com", temp);
    expect(res.statusCode).toBe(200); // login itself works, so the UI can send them to the change screen
    expect(res.json().user.mustChangePassword).toBe(true);

    expect((await get("/api/auth/me", cookie)).statusCode).toBe(200);
    for (const url of ["/api/_probe/any", "/api/_probe/employee", "/api/users"]) {
      const blocked = await get(url, cookie);
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    expect(
      (await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
  });

  it("unlocks everything after a successful change, and the old password stops working", async () => {
    const temp = await newEmployee("second@example.com");
    const { cookie } = await loginCookie(ctx.app, "second@example.com", temp);

    const done = await change(cookie, { currentPassword: temp, newPassword: NEW_PW });
    expect(done.statusCode).toBe(200);
    expect(done.body).not.toContain(NEW_PW);
    expect(done.body).not.toContain(temp);

    expect((await get("/api/_probe/employee", cookie)).statusCode).toBe(200);
    expect((await get("/api/auth/me", cookie)).json().user.mustChangePassword).toBe(false);
    expect((await loginCookie(ctx.app, "second@example.com", temp)).res.statusCode).toBe(401);
    const fresh = await loginCookie(ctx.app, "second@example.com", NEW_PW);
    expect(fresh.res.statusCode).toBe(200);
    expect(fresh.res.json().user.mustChangePassword).toBe(false);
  });

  it("rejects a wrong current password, a weak or unchanged new one, and stays locked", async () => {
    const temp = await newEmployee("third@example.com");
    const { cookie } = await loginCookie(ctx.app, "third@example.com", temp);

    const wrong = await change(cookie, { currentPassword: "not-the-temp", newPassword: NEW_PW });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect((await change(cookie, { currentPassword: temp, newPassword: "short" })).statusCode).toBe(
      422,
    );
    const same = await change(cookie, { currentPassword: temp, newPassword: temp });
    expect(same.json().error.code).toBe("PASSWORD_UNCHANGED");
    expect((await change(cookie, {})).statusCode).toBe(422);

    expect((await get("/api/_probe/any", cookie)).statusCode).toBe(403); // still locked out
    const [row] = await ctx.t.db.select().from(users).where(eq(users.email, "third@example.com"));
    expect(row?.mustChangePassword).toBe(true);
  });

  it("limits wrong current-password guesses per user", async () => {
    const temp = await newEmployee("fourth@example.com");
    const { cookie } = await loginCookie(ctx.app, "fourth@example.com", temp);
    for (let i = 0; i < 5; i++) {
      expect(
        (await change(cookie, { currentPassword: `guess-${i}-guess`, newPassword: NEW_PW }))
          .statusCode,
      ).toBe(422);
    }
    const blocked = await change(cookie, { currentPassword: temp, newPassword: NEW_PW });
    expect(blocked.statusCode).toBe(429); // even the right password is refused while blocked
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("also lets a normal user change their password, and requires a session", async () => {
    const { cookie } = await loginCookie(ctx.app, "rohan@demo.com");
    expect(
      (await change(cookie, { currentPassword: TEST_PASSWORD, newPassword: NEW_PW })).statusCode,
    ).toBe(200);
    expect((await loginCookie(ctx.app, "rohan@demo.com", NEW_PW)).res.statusCode).toBe(200);
    const anon = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      payload: { currentPassword: "x", newPassword: NEW_PW },
    });
    expect(anon.statusCode).toBe(401);
  });

  it("applies to admins as well", async () => {
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.email, "anita@demo.com"));
    const { cookie } = await loginCookie(ctx.app, "anita@demo.com");
    expect((await get("/api/_probe/employee", cookie)).json().error.code).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );
    await ctx.t.db.update(users).set({ role: "ADMIN" }).where(eq(users.email, "anita@demo.com"));
    expect((await get("/api/users", cookie)).json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});
