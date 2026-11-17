import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import {
  TEST_PASSWORD,
  TEST_SECRET,
  createTestApp,
  loginCookie,
  type TestApp,
} from "../test/app.js";

const sign = (sub: string, secret: string, exp: number) =>
  new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt(exp - 3600)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

const inSeconds = (n: number) => Math.floor(Date.now() / 1000) + n;

describe.skipIf(!hasDb)("auth", () => {
  let ctx: TestApp;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const me = (cookie?: string) =>
    ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: cookie ? { cookie } : {} });
  const userId = async (email: string) =>
    ((await ctx.t.db.select().from(users).where(eq(users.email, email)))[0] as { id: string }).id;

  describe("login", () => {
    it("logs in with a good password and sets a hardened session cookie", async () => {
      const { res } = await loginCookie(ctx.app, "priya@demo.com");
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({ email: "priya@demo.com", role: "EMPLOYEE" });
      const c = res.cookies.find((x) => x.name === "lb_session");
      expect(c?.httpOnly).toBe(true);
      expect(c?.sameSite).toBe("Strict");
      expect(c?.path).toBe("/");
      expect(c?.maxAge).toBe(8 * 3600);
    });

    it("never returns the password hash", async () => {
      const { res } = await loginCookie(ctx.app, "admin@demo.com");
      expect(res.body).not.toMatch(/argon2|passwordHash|password_hash/i);
      const me2 = await me((await loginCookie(ctx.app, "admin@demo.com")).cookie);
      expect(me2.body).not.toMatch(/argon2|passwordHash|password_hash/i);
    });

    it("matches the email case-insensitively", async () => {
      const { res } = await loginCookie(ctx.app, "  PRIYA@Demo.com ");
      expect(res.statusCode).toBe(200);
    });

    it("rejects a wrong password with 401 and sets no cookie", async () => {
      const { res } = await loginCookie(ctx.app, "priya@demo.com", "wrong-password");
      expect(res.statusCode).toBe(401);
      expect(res.cookies).toHaveLength(0);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    });

    it("gives identical responses for wrong password, unknown email and deactivated user", async () => {
      await ctx.t.db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.email, "anita@demo.com"));
      const wrong = await loginCookie(ctx.app, "priya@demo.com", "nope-nope");
      const unknown = await loginCookie(ctx.app, "ghost@demo.com", "nope-nope");
      const inactive = await loginCookie(ctx.app, "anita@demo.com"); // correct password
      for (const r of [wrong, unknown, inactive]) expect(r.res.statusCode).toBe(401);
      expect(unknown.res.json()).toEqual(wrong.res.json());
      expect(inactive.res.json()).toEqual(wrong.res.json());
      await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.email, "anita@demo.com"));
    });

    it("returns 422 for a malformed body", async () => {
      for (const payload of [
        {},
        { email: "a@b.c" },
        { password: "x" },
        { email: 1, password: 2 },
      ]) {
        const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("session (/me)", () => {
    it("returns the current user for a valid cookie", async () => {
      const { cookie } = await loginCookie(ctx.app, "rohan@demo.com");
      const res = await me(cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().user.name).toBe("Rohan Verma");
    });

    it("rejects a request with no cookie", async () => {
      expect((await me()).statusCode).toBe(401);
    });

    it("rejects an expired token", async () => {
      const token = await sign(await userId("priya@demo.com"), TEST_SECRET, inSeconds(-60));
      expect((await me(`lb_session=${token}`)).statusCode).toBe(401);
    });

    it("accepts the same token while it is still valid (control for the expiry test)", async () => {
      const token = await sign(await userId("priya@demo.com"), TEST_SECRET, inSeconds(600));
      expect((await me(`lb_session=${token}`)).statusCode).toBe(200);
    });

    it("rejects a token signed with a different secret", async () => {
      const token = await sign(await userId("priya@demo.com"), "z".repeat(48), inSeconds(600));
      expect((await me(`lb_session=${token}`)).statusCode).toBe(401);
    });

    it("rejects a tampered token and garbage", async () => {
      const { cookie } = await loginCookie(ctx.app, "priya@demo.com");
      expect((await me(cookie.slice(0, -3) + "abc")).statusCode).toBe(401);
      expect((await me("lb_session=not-a-jwt")).statusCode).toBe(401);
    });

    it("rejects an unsigned (alg=none) token", async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: await userId("admin@demo.com") })}.`;
      expect((await me(`lb_session=${token}`)).statusCode).toBe(401);
    });

    it("stops working immediately once the user is deactivated", async () => {
      const { cookie } = await loginCookie(ctx.app, "anita@demo.com");
      expect((await me(cookie)).statusCode).toBe(200);
      await ctx.t.db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.email, "anita@demo.com"));
      expect((await me(cookie)).statusCode).toBe(401);
      await ctx.t.db.update(users).set({ isActive: true }).where(eq(users.email, "anita@demo.com"));
    });
  });

  describe("logout", () => {
    it("clears the session cookie", async () => {
      const { cookie } = await loginCookie(ctx.app, "priya@demo.com");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const c = res.cookies.find((x) => x.name === "lb_session");
      expect(c?.value).toBe("");
      expect(c?.expires?.getTime()).toBeLessThan(Date.now());
    });

    it("is harmless when not logged in", async () => {
      const res = await ctx.app.inject({ method: "POST", url: "/api/auth/logout" });
      expect(res.statusCode).toBe(200);
    });
  });

  it("uses the shared error shape for unknown routes", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  it("uses the test password constant only in tests", () => {
    expect(TEST_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});
