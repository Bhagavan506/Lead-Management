import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activityFeed,
  lostReasons,
  overviewStats,
  staleLeads,
  teamStats,
} from "../services/stats.js";
import {
  getStaleDays,
  setStaleDays,
  STALE_DAYS_MAX,
  STALE_DAYS_MIN,
} from "../services/settings.js";

const feedQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
});

const settingsBody = z
  .object({ staleDays: z.number().int().min(STALE_DAYS_MIN).max(STALE_DAYS_MAX) })
  .strict();

/** Admin insights. Every route is admin-only: employees must never see team-wide numbers. */
export async function statsRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.guard("ADMIN") };
  const tz = () => app.config.APP_TIMEZONE;

  app.get("/stats/overview", admin, async () => overviewStats(app.db, tz()));
  app.get("/stats/team", admin, async () => teamStats(app.db, tz()));
  app.get("/stats/stale", admin, async () => staleLeads(app.db));
  app.get("/stats/lost-reasons", admin, async () => lostReasons(app.db));
  app.get("/activity", admin, async (req) => {
    const q = feedQuery.parse(req.query);
    return activityFeed(app.db, q.page, q.pageSize);
  });

  app.get("/settings", admin, async () => ({ staleDays: await getStaleDays(app.db) }));
  app.put("/settings", admin, async (req) => {
    const body = settingsBody.parse(req.body);
    await setStaleDays(app.db, body.staleDays);
    return { staleDays: await getStaleDays(app.db) };
  });
}
