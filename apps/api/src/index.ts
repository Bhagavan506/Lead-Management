import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

// Load the repo-root .env for local dev. Real environment variables always win (production).
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const app = buildApp(config, db);

app.addHook("onClose", async () => {
  await pool.end();
});

app.listen({ port: config.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
