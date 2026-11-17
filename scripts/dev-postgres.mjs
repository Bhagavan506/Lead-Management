// Optional: run a local Postgres without Docker (used in sandboxes/CI-less machines).
// Normal dev uses `docker compose up -d`. Usage: node scripts/dev-postgres.mjs [dataDir]
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dataDir = process.argv[2] ?? "/tmp/leadbook-pg";
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "leadbook",
  password: "leadbook",
  port: 5432,
  persistent: true,
});
if (!existsSync(`${dataDir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("leadbook");
} catch {
  /* already exists */
}
console.warn("postgres ready on 5432");
process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
