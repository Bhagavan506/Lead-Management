import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool);
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
