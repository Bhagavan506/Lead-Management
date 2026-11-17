import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { seed } from "../db/seed.js";
import { createTestDb, type TestDb } from "./db.js";

export const TEST_PASSWORD = "Test-Password-123";
export const TEST_SECRET = "test-secret-".padEnd(48, "x");

export interface TestApp {
  app: FastifyInstance;
  t: TestDb;
  close: () => Promise<void>;
}

/** Fresh database + seeded demo data + app instance. */
export async function createTestApp(
  env: Record<string, string> = {},
  /** Mount extra routes (e.g. guarded probes) before the app becomes ready. */
  configure?: (app: FastifyInstance) => void,
): Promise<TestApp> {
  const t = await createTestDb();
  await seed(t.db, { password: TEST_PASSWORD, defaultCountry: "IN", timeZone: "Asia/Kolkata" });
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: t.url,
    JWT_SECRET: TEST_SECRET,
    ...env,
  });
  const app = buildApp(config, t.db);
  // Registered (not called directly) so it runs after the auth plugin has decorated the app.
  if (configure) app.register(async (instance) => configure(instance));
  await app.ready();
  return {
    app,
    t,
    close: async () => {
      await app.close();
      await t.drop();
    },
  };
}

/** Logs in and returns the Cookie header value to send on later requests. */
export async function loginCookie(app: FastifyInstance, email: string, password = TEST_PASSWORD) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  const set = res.cookies.find((c) => c.name === "lb_session");
  return { res, cookie: set ? `lb_session=${set.value}` : "" };
}
