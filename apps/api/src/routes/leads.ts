import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { CsvFileError, parseLeadCsv } from "../lib/csv-leads.js";
import type { SessionUser } from "../plugins/auth.js";
import { assignLead } from "../services/lead-assign.js";
import { autoAssignLeads } from "../services/lead-auto-assign.js";
import { uploadLeads, type UploadMode } from "../services/lead-upload.js";
import { getLeadDetail, listLeads } from "../services/leads.js";

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

const UPLOAD_BODY_LIMIT = 6 * 1024 * 1024;

const uploadBody = z
  .object({
    csv: z
      .string()
      .min(1)
      .max(5 * 1024 * 1024),
    mode: z.enum(["none", "split", "owner"]).default("none"),
    ownerId: z.string().uuid().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.mode === "owner" && !b.ownerId)
      ctx.addIssue({ code: "custom", path: ["ownerId"], message: "Required when mode is owner" });
    if (b.mode !== "owner" && b.ownerId)
      ctx.addIssue({
        code: "custom",
        path: ["ownerId"],
        message: "Only allowed when mode is owner",
      });
  });

const assignBody = z.object({ ownerId: z.string().uuid().nullable() });

const idParams = z.object({ id: z.string().uuid() });

export async function leadRoutes(app: FastifyInstance) {
  // Any signed-in role; what they get back is decided by the query-layer scope, not by this guard.
  app.get("/", { preHandler: app.guard() }, async (req) => {
    const q = listQuery.parse(req.query);
    return listLeads(app.db, req.user as SessionUser, q);
  });

  app.get("/:id", { preHandler: app.guard() }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getLeadDetail(app.db, req.user as SessionUser, id);
  });

  // Admin only. Auth runs in onRequest, i.e. before the (large) body is read, so anonymous clients
  // cannot make the server buffer megabytes just to be rejected.
  app.post(
    "/upload",
    { onRequest: app.guard("ADMIN"), bodyLimit: UPLOAD_BODY_LIMIT },
    async (req, reply) => {
      const body = uploadBody.parse(req.body);
      let parsed;
      try {
        parsed = parseLeadCsv(body.csv, app.config.DEFAULT_COUNTRY_CODE);
      } catch (e) {
        if (e instanceof CsvFileError) throw new AppError(422, "INVALID_FILE", e.message);
        throw e;
      }
      const mode: UploadMode =
        body.mode === "owner"
          ? { kind: "owner", ownerId: body.ownerId as string }
          : { kind: body.mode };
      const admin = req.user as SessionUser;
      const report = await uploadLeads(app.db, { id: admin.id, name: admin.name }, parsed, mode);
      return reply.status(200).send(report);
    },
  );

  // Admin only. ownerId = an active employee's id, or null to move the lead back to the pool.
  app.post("/:id/assign", { preHandler: app.guard("ADMIN") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { ownerId } = assignBody.parse(req.body);
    const admin = req.user as SessionUser;
    const { changed } = await assignLead(app.db, { id: admin.id }, id, ownerId);
    return { changed, ...(await getLeadDetail(app.db, admin, id)) };
  });

  // Admin only. Gives every unassigned open lead to the least-loaded active employee.
  app.post("/auto-assign", { preHandler: app.guard("ADMIN") }, async (req) => {
    return autoAssignLeads(app.db, { id: (req.user as SessionUser).id });
  });
}
