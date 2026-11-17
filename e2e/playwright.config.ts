import { defineConfig, devices } from "@playwright/test";

const API = 3100;
const WEB = 5273;
const DB = "postgresql://leadbook:leadbook@localhost:5432/leadbook_e2e";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // one shared database; the specs build on each other
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      // Uses the system Chrome so no browser download is needed.
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @leadbook/api exec tsx src/test/e2e-prepare.ts && pnpm --filter @leadbook/api exec tsx src/index.ts`,
      cwd: "..",
      url: `http://localhost:${API}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "development",
        PORT: String(API),
        DATABASE_URL: DB,
        JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
        COOKIE_SECURE: "false",
        CORS_ORIGIN: `http://localhost:${WEB}`,
        WHATSAPP_PROVIDER: "mock",
        SCHEDULER_ENABLED: "false",
      },
    },
    {
      command: `pnpm --filter @leadbook/web exec vite --port ${WEB} --strictPort`,
      cwd: "..",
      url: `http://localhost:${WEB}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { VITE_API_URL: `http://localhost:${API}` },
    },
  ],
});
