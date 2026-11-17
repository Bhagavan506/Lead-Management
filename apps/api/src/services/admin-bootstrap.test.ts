import { afterAll, beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { hasDb, createTestDb, type TestDb } from "../test/db.js";
import { BootstrapError, createFirstAdmin } from "./admin-bootstrap.js";

describe.skipIf(!hasDb)("first admin bootstrap", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });
  const input = { name: " Owner ", email: " Owner@Example.COM ", password: "a-long-password-1" };

  it.each([
    [{ ...input, name: "  " }, /ADMIN_NAME/],
    [{ ...input, email: "nope" }, /ADMIN_EMAIL/],
    [{ ...input, password: "short" }, /at least 12/],
  ])("rejects bad input %#", async (bad, msg) => {
    await expect(createFirstAdmin(t.db, bad)).rejects.toThrow(msg);
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("creates one admin with a hashed temporary password, and refuses a second run", async () => {
    const a = await createFirstAdmin(t.db, input);
    expect(a.email).toBe("owner@example.com");
    const row = (await t.db.select().from(users).where(eq(users.id, a.id)))[0]!;
    expect(row).toMatchObject({
      role: "ADMIN",
      name: "Owner",
      isActive: true,
      mustChangePassword: true,
    });
    expect(row.passwordHash).not.toContain(input.password);
    expect(await argon2.verify(row.passwordHash, input.password)).toBe(true);
    await expect(
      createFirstAdmin(t.db, { ...input, email: "other@example.com" }),
    ).rejects.toBeInstanceOf(BootstrapError);
    expect(await t.db.select().from(users)).toHaveLength(1);
  });
});
