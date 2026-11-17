import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("database connectivity", () => {
  const { db, pool } = createDb(url ?? "");
  afterAll(() => pool.end());

  it("runs the migration runner and answers a query", async () => {
    await runMigrations(url as string);
    const res = await db.execute(sql`select 1 as ok`);
    expect(res.rows[0]).toEqual({ ok: 1 });
  });
});
