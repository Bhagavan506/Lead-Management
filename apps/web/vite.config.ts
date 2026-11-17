/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The browser talks to its own origin and Vite forwards /api and /health to the API. That keeps the
// session cookie first-party (SameSite=Strict works) and needs no CORS in development. In production
// serve the web build and the API from the same site (see docs/DEPLOY.md).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const target = env.VITE_API_URL || "http://localhost:3000";
  return {
    envDir: "../..",
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { "/api": target, "/health": target },
    },
    preview: { port: 4173, proxy: { "/api": target, "/health": target } },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
