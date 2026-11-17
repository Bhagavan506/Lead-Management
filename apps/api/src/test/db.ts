import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDb } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";

/** True when a Postgres is configured for integration tests. */
export const hasDb = Boolean(process.env.DATABASE_URL);

export interface TestDb {
  url: string;
  db: ReturnType<typeof createDb>["db"];
  pool: pg.Pool;
  drop: () => Promise<void>;
}

/** Creates a brand-new empty database, applies all migrations, and returns handles. */
export async function createTestDb(): Promise<TestDb> {
  const base = new URL(process.env.DATABASE_URL as string);
  const name = `leadbook_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const { db, pool } = createDb(url.toString());

  return {
    url: url.toString(),
    db,
    pool,
    drop: async () => {
      await pool.end();
      const a = new pg.Client({ connectionString: base.toString() });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
