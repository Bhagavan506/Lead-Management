import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
  });

  app.decorate("config", config);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
  }
}
