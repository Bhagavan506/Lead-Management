import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { TEST_PASSWORD, createTestApp, loginCookie, type TestApp } from "../test/app.js";

describe.skipIf(!hasDb)("users: create and list (admin)", () => {
  let ctx: TestApp;
  let admin: string;
  let employee: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = (await loginCookie(ctx.app, "admin@demo.com")).cookie;
    employee = (await loginCookie(ctx.app, "priya@demo.com")).cookie;
  });
  afterAll(() => ctx.close());

  const create = (payload: unknown, cookie = admin) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie },
      payload: payload as object,
    });
  const list = (cookie = admin) =>
    ctx.app.inject({ method: "GET", url: "/api/users", headers: { cookie } });

  it("creates an employee, returns a temporary password once, and never the hash", async () => {
    const res = await create({
      name: "Neha Gupta",
      email: "neha@example.com",
      phone: "98765 43210",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({
      name: "Neha Gupta",
      email: "neha@example.com",
      role: "EMPLOYEE",
      phone: "+919876543210",
      isActive: true,
      mustChangePassword: true,
      openLeads: 0,
    });
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);
    expect(res.body).not.toMatch(/argon2|passwordHash|password_hash/i);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("stores only a hash of the temporary password, and it works for login", async () => {
    const { temporaryPassword } = (
      await create({ name: "Karan Shah", email: "karan@example.com", phone: "9123456780" })
    ).json();
    const [row] = await ctx.t.db.select().from(users).where(eq(users.email, "karan@example.com"));
    expect(row?.passwordHash).not.toContain(temporaryPassword);
    expect(row?.passwordHash.startsWith("$argon2")).toBe(true);
    const login = await loginCookie(ctx.app, "karan@example.com", temporaryPassword);
    expect(login.res.statusCode).toBe(200);
    expect(login.res.json().user.mustChangePassword).toBe(true);
  });

  it("generates a different password each time", async () => {
    const a = (
      await create({ name: "A One", email: "a1@example.com", phone: "9000000011" })
    ).json();
    const b = (
      await create({ name: "B Two", email: "b2@example.com", phone: "9000000022" })
    ).json();
    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  });

  it("never exposes the password or hash when listing", async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/argon2|passwordHash|password_hash|temporaryPassword/i);
    const all = res.json().users as { email: string; openLeads: number; role: string }[];
    expect(all.find((u) => u.email === "priya@demo.com")?.openLeads).toBe(2);
    expect(all.find((u) => u.email === "anita@demo.com")?.openLeads).toBe(0); // her leads are Won/Lost
    expect(all.filter((u) => u.role === "ADMIN")).toHaveLength(1);
  });

  it("rejects a duplicate email regardless of case with 409", async () => {
    const res = await create({ name: "Dup", email: "PRIYA@demo.com", phone: "9000000033" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects an invalid phone number or email with 422", async () => {
    const badPhone = await create({ name: "X", email: "x@example.com", phone: "12" });
    expect(badPhone.statusCode).toBe(422);
    expect(badPhone.json().error.details[0].path).toBe("phone");
    expect(
      (await create({ name: "X", email: "not-an-email", phone: "9000000044" })).statusCode,
    ).toBe(422);
    expect(
      (await create({ name: "", email: "y@example.com", phone: "9000000044" })).statusCode,
    ).toBe(422);
    expect((await create({})).statusCode).toBe(422);
  });

  it("is admin-only: employees get 403, anonymous gets 401", async () => {
    const payload = { name: "Z", email: "z@example.com", phone: "9000000055" };
    expect((await create(payload, employee)).statusCode).toBe(403);
    expect((await list(employee)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: "/api/users" })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/api/users", payload })).statusCode).toBe(
      401,
    );
    const [none] = await ctx.t.db.select().from(users).where(eq(users.email, "z@example.com"));
    expect(none).toBeUndefined();
  });

  it("cannot be used to create an admin", async () => {
    const res = await create({
      name: "Sneaky",
      email: "sneaky@example.com",
      phone: "9000000066",
      role: "ADMIN",
    });
    expect(res.json().user.role).toBe("EMPLOYEE");
  });

  it("keeps the seed password constant out of the new account", async () => {
    const { temporaryPassword } = (
      await create({ name: "Q", email: "q@example.com", phone: "9000000077" })
    ).json();
    expect(temporaryPassword).not.toBe(TEST_PASSWORD);
  });
});
