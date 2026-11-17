import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { activities, leads, reminderLog, users } from "./schema.js";
import { createTestDb, hasDb, type TestDb } from "../test/db.js";

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return (err.cause ?? err).message;
  }
  return "NO ERROR";
}

describe.skipIf(!hasDb)("schema constraints (fresh database)", () => {
  let t: TestDb;
  let employeeId: string;

  beforeAll(async () => {
    t = await createTestDb();
    const [u] = await t.db
      .insert(users)
      .values({ name: "Priya", email: "priya@example.com", passwordHash: "x", role: "EMPLOYEE" })
      .returning();
    employeeId = (u as { id: string }).id;
  });
  afterAll(() => t.drop());

  const lead = (over: Partial<typeof leads.$inferInsert> = {}) => ({
    name: "Aarav",
    phone: "+919810000001",
    ...over,
  });

  it("applies cleanly on an empty database and creates every table", async () => {
    const res = await t.db.execute(
      sql`select table_name from information_schema.tables where table_schema='public' order by 1`,
    );
    const names = res.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(["users", "leads", "activities", "settings", "reminder_log"]),
    );
  });

  it("has the required indexes", async () => {
    const res = await t.db.execute(sql`select indexname from pg_indexes where schemaname='public'`);
    const names = res.rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(["leads_phone_key", "leads_owner_id_idx", "leads_status_idx"]),
    );
  });

  it("rejects a duplicate phone number (rule 2)", async () => {
    await t.db.insert(leads).values(lead({ phone: "+919810000010" }));
    await expect(t.db.insert(leads).values(lead({ phone: "+919810000010" }))).rejects.toThrow();
  });

  it("rejects phones that are not E.164", async () => {
    await expect(t.db.insert(leads).values(lead({ phone: "9810000099" }))).rejects.toThrow();
  });

  it("requires a lost reason exactly when status is LOST (rule 5)", async () => {
    await expect(
      t.db.insert(leads).values(lead({ phone: "+919810000020", status: "LOST" })),
    ).rejects.toThrow();
    await expect(
      t.db
        .insert(leads)
        .values(lead({ phone: "+919810000021", status: "NEW", lostReason: "PRICE" })),
    ).rejects.toThrow();
    await t.db
      .insert(leads)
      .values(lead({ phone: "+919810000022", status: "LOST", lostReason: "PRICE" }));
  });

  it("treats emails case-insensitively as unique", async () => {
    await expect(
      t.db
        .insert(users)
        .values({ name: "Dup", email: "PRIYA@example.com", passwordHash: "x", role: "EMPLOYEE" }),
    ).rejects.toThrow();
  });

  it("makes activities append-only (rule 6)", async () => {
    const [l] = await t.db
      .insert(leads)
      .values(lead({ phone: "+919810000030" }))
      .returning();
    const leadId = (l as { id: string }).id;
    await t.db
      .insert(activities)
      .values({ leadId, actorId: employeeId, type: "NOTE", text: "Note: hello" });
    expect(await pgError(t.db.execute(sql`update activities set text='x'`))).toMatch(/append-only/);
    expect(await pgError(t.db.execute(sql`delete from activities`))).toMatch(/append-only/);
    expect(await pgError(t.db.execute(sql`truncate activities`))).toMatch(/append-only/);
  });

  it("allows one scheduled reminder per employee per day, but many manual ones (rule 10)", async () => {
    const row = (kind: "SCHEDULED" | "MANUAL") => ({
      employeeId,
      date: "2026-11-17",
      kind,
      messageText: "m",
      provider: "mock",
      status: "SENT",
    });
    await t.db.insert(reminderLog).values(row("SCHEDULED"));
    await expect(t.db.insert(reminderLog).values(row("SCHEDULED"))).rejects.toThrow();
    await t.db.insert(reminderLog).values(row("MANUAL"));
    await t.db.insert(reminderLog).values(row("MANUAL"));
  });
});
