import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://x:x@localhost:5432/x",
  JWT_SECRET: "x".repeat(32),
});

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const app = buildApp(config);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
