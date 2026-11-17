import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { AppError } from "./errors.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { leadRoutes } from "./routes/leads.js";
import { statsRoutes } from "./routes/stats.js";
import { userRoutes } from "./routes/users.js";

export function buildApp(config: Config, db: Db): FastifyInstance {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger:
      config.NODE_ENV === "test"
        ? false
        : { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
  });

  app.decorate("config", config);
  app.decorate("db", db);
  app.register(helmet);
  app.register(cors, {
    origin: config.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
  app.register(cookie);
  app.register(authPlugin);

  // One error shape everywhere: { error: { code, message, details? } }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .status(status)
        .send({ error: { code: "BAD_REQUEST", message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } }),
  );

  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(userRoutes, { prefix: "/api/users" });
  app.register(leadRoutes, { prefix: "/api/leads" });
  app.register(statsRoutes, { prefix: "/api" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
}
