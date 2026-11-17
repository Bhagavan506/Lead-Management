import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SessionUser } from "../plugins/auth.js";
import { listLeads } from "../services/leads.js";

const listQuery = z.object({
  owner: z.union([z.literal("none"), z.string().uuid()]).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]).optional(),
  stale: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function leadRoutes(app: FastifyInstance) {
  // Any signed-in role; what they get back is decided by the query-layer scope, not by this guard.
  app.get("/", { preHandler: app.guard() }, async (req) => {
    const q = listQuery.parse(req.query);
    return listLeads(app.db, req.user as SessionUser, q);
  });
}
