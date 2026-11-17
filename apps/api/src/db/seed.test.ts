import argon2 from "argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, isNull } from "drizzle-orm";
import { activities, leads, settings, users } from "./schema.js";
import { seed } from "./seed.js";
import { createTestDb, hasDb, type TestDb } from "../test/db.js";

const opts = { password: "Demo-Password-1", defaultCountry: "IN", timeZone: "Asia/Kolkata" };

describe.skipIf(!hasDb)("seed", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await seed(t.db, opts);
  });
  afterAll(() => t.drop());

  const total = async (table: typeof users | typeof leads | typeof activities | typeof settings) =>
    ((await t.db.select({ n: count() }).from(table))[0] as { n: number }).n;

  it("creates 1 admin, 3 employees, 9 leads, 20 history entries and 3 settings", async () => {
    const all = await t.db.select().from(users);
    expect(all.filter((u) => u.role === "ADMIN")).toHaveLength(1);
    expect(all.filter((u) => u.role === "EMPLOYEE")).toHaveLength(3);
    expect(await total(leads)).toBe(9);
    expect(await total(activities)).toBe(20);
    expect(await total(settings)).toBe(3);
  });

  it("is repeatable: a second run changes nothing", async () => {
    await seed(t.db, opts);
    await seed(t.db, opts);
    expect(await total(users)).toBe(4);
    expect(await total(leads)).toBe(9);
    expect(await total(activities)).toBe(20);
    expect(await total(settings)).toBe(3);
  });

  it("matches the prototype: 3 unassigned, owners, statuses and the lost reason", async () => {
    expect((await t.db.select({ n: count() }).from(leads).where(isNull(leads.ownerId)))[0]?.n).toBe(
      3,
    );
    const nisha = (await t.db.select().from(leads).where(eq(leads.phone, "+919810000006")))[0];
    expect(nisha?.status).toBe("LOST");
    expect(nisha?.lostReason).toBe("WRONG_CONTACT");
    const kabir = (await t.db.select().from(leads).where(eq(leads.phone, "+919810000005")))[0];
    expect(kabir?.status).toBe("WON");
    expect(kabir?.followUpDate).toBeNull();
  });

  it("stores E.164 phones and hashed passwords only", async () => {
    const rows = await t.db.select().from(leads);
    for (const l of rows) expect(l.phone).toMatch(/^\+[1-9]\d{7,14}$/);
    const admin = (await t.db.select().from(users).where(eq(users.email, "admin@demo.com")))[0];
    expect(admin?.passwordHash).not.toContain("Demo-Password-1");
    expect(await argon2.verify(admin?.passwordHash ?? "", "Demo-Password-1")).toBe(true);
  });

  it("sets lastActivityAt to the newest history entry of each lead", async () => {
    const rows = await t.db.select().from(leads);
    for (const l of rows) {
      const acts = await t.db.select().from(activities).where(eq(activities.leadId, l.id));
      const newest = Math.max(...acts.map((a) => a.createdAt.getTime()));
      expect(l.lastActivityAt.getTime()).toBe(newest);
    }
  });
});
