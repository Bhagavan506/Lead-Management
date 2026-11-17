import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MockProvider } from "../whatsapp/mock.js";
import { loadConfig } from "../config.js";
import { seed } from "../db/seed.js";
import { createTestDb, type TestDb } from "./db.js";

export const TEST_PASSWORD = "Test-Password-123";
export const TEST_SECRET = "test-secret-".padEnd(48, "x");

export interface TestApp {
  app: FastifyInstance;
  t: TestDb;
  /** The provider the app sends through: inspect `.sent` / set `.failWith`. */
  provider: MockProvider;
  close: () => Promise<void>;
}

/** Fresh database + seeded demo data + app instance. */
export async function createTestApp(
  env: Record<string, string> = {},
  /** Mount extra routes (e.g. guarded probes) before the app becomes ready. */
  configure?: (app: FastifyInstance) => void,
  /** Build the provider from the env (e.g. WHATSAPP_PROVIDER=meta) instead of injecting the mock. */
  opts: { realProvider?: boolean } = {},
): Promise<TestApp> {
  const t = await createTestDb();
  await seed(t.db, { password: TEST_PASSWORD, defaultCountry: "IN", timeZone: "Asia/Kolkata" });
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: t.url,
    JWT_SECRET: TEST_SECRET,
    SCHEDULER_ENABLED: "false",
    ...env,
  });
  const provider = new MockProvider();
  const app = buildApp(config, t.db, opts.realProvider ? {} : { provider });
  // Registered (not called directly) so it runs after the auth plugin has decorated the app.
  if (configure) app.register(async (instance) => configure(instance));
  await app.ready();
  return {
    app,
    t,
    provider,
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
