import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://x:x@localhost:5432/x",
  JWT_SECRET: "x".repeat(32),
});

describe("GET /health", () => {
  it("returns 200 ok without touching the database", async () => {
    const { db, pool } = createDb(config.DATABASE_URL);
    const app = buildApp(config, db);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
    await pool.end();
  });
});
