/**
 * Creates a fresh throwaway database for the Playwright suite, migrates it and
 * loads the demo seed. Never touches the dev database: the name is fixed.
 */
import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createDb } from "../db/client.js";
import { seed } from "../db/seed.js";

const admin =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://leadbook:leadbook@localhost:5432/postgres";
const NAME = "leadbook_e2e";
const url = new URL(admin);
url.pathname = `/${NAME}`;

const c = new pg.Client({ connectionString: admin });
await c.connect();
await c.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
await c.query(`CREATE DATABASE ${NAME}`);
await c.end();

await runMigrations(url.toString());
const { db, pool } = createDb(url.toString());
try {
  await seed(db, { password: "e2e-password-1", defaultCountry: "IN", timeZone: "Asia/Kolkata" });
} finally {
  await pool.end();
}
console.warn(`e2e database ready: ${NAME}`);
