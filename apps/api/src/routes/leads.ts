import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { CsvFileError, parseLeadCsv } from "../lib/csv-leads.js";
import type { SessionUser } from "../plugins/auth.js";
import { assignLead } from "../services/lead-assign.js";
import { addNote, logCall, recordContactEvent, setFollowUp } from "../services/lead-actions.js";
import { updateLeadDetails } from "../services/lead-details.js";
import { changeStatus } from "../services/lead-status.js";
import { autoAssignLeads } from "../services/lead-auto-assign.js";
import { uploadLeads, type UploadMode } from "../services/lead-upload.js";
import { getLeadDetail, listLeads, mySummary } from "../services/leads.js";
import { dateInTz } from "../lib/dates.js";

const listQuery = z.object({
  owner: z.union([z.literal("none"), z.string().uuid()]).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]).optional(),
  stale: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  followUp: z.enum(["due", "scheduled"]).optional(),
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

const statusBody = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]),
  lostReason: z
    .enum(["PRICE", "NO_RESPONSE", "CHOSE_COMPETITOR", "WRONG_CONTACT", "NOT_INTERESTED", "OTHER"])
    .optional(),
});

const callBody = z.object({ outcome: z.enum(["ANSWERED", "NO_ANSWER", "BUSY", "WRONG_NUMBER"]) });
const noteBody = z.object({ text: z.string().trim().min(1).max(2000) });
const followUpBody = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (d) =>
        !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
        new Date(`${d}T00:00:00Z`).toISOString().startsWith(d),
      "Not a real date",
    )
    .nullable(),
});
const detailText = (max: number) => z.string().trim().max(max);
const detailsBody = z
  .object({
    name: detailText(200),
    community: detailText(200),
    flatNumber: detailText(50),
    address: detailText(1000),
    flatType: detailText(100),
    area: detailText(100),
    requirements: detailText(2000),
  })
  .partial()
  .strict();
const contactBody = z.object({ kind: z.enum(["CALL", "WHATSAPP"]) });

const assignBody = z.object({ ownerId: z.string().uuid().nullable() });

const idParams = z.object({ id: z.string().uuid() });

export async function leadRoutes(app: FastifyInstance) {
  // Any signed-in role; what they get back is decided by the query-layer scope, not by this guard.
  app.get("/", { preHandler: app.guard() }, async (req) => {
    const q = listQuery.parse(req.query);
    return listLeads(
      app.db,
      req.user as SessionUser,
      q,
      new Date(),
      dateInTz(app.config.APP_TIMEZONE),
    );
  });

  // The employee's own numbers for the My leads screen. Admins have /api/stats instead.
  app.get("/summary", { preHandler: app.guard("EMPLOYEE") }, async (req) =>
    mySummary(app.db, req.user as SessionUser, dateInTz(app.config.APP_TIMEZONE)),
  );

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

  // Lead work: employees only (admins are read-only, rule 4), and only on leads they own (404 otherwise).
  app.patch("/:id/status", { preHandler: app.guard("EMPLOYEE") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { status, lostReason } = statusBody.parse(req.body);
    const user = req.user as SessionUser;
    const { changed } = await changeStatus(app.db, user, id, status, lostReason);
    return { changed, ...(await getLeadDetail(app.db, user, id)) };
  });

  const work = { preHandler: app.guard("EMPLOYEE") };

  app.post("/:id/calls", work, async (req) => {
    const { id } = idParams.parse(req.params);
    const { outcome } = callBody.parse(req.body);
    const user = req.user as SessionUser;
    await logCall(app.db, user, id, outcome, app.config.APP_TIMEZONE);
    return getLeadDetail(app.db, user, id);
  });

  app.post("/:id/notes", work, async (req) => {
    const { id } = idParams.parse(req.params);
    const { text } = noteBody.parse(req.body);
    const user = req.user as SessionUser;
    await addNote(app.db, user, id, text);
    return getLeadDetail(app.db, user, id);
  });

  app.patch("/:id/follow-up", work, async (req) => {
    const { id } = idParams.parse(req.params);
    const { date } = followUpBody.parse(req.body);
    const user = req.user as SessionUser;
    const result = await setFollowUp(app.db, user, id, date);
    if (result === "CLOSED")
      throw new AppError(422, "LEAD_CLOSED", "Won and Lost leads cannot have a follow-up date", [
        { path: "date", message: "Reopen the lead first" },
      ]);
    return { changed: result === "CHANGED", ...(await getLeadDetail(app.db, user, id)) };
  });

  app.patch("/:id/details", work, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = detailsBody.parse(req.body);
    const user = req.user as SessionUser;
    const changed = await updateLeadDetails(app.db, user, id, body);
    return { changed: changed.length > 0, ...(await getLeadDetail(app.db, user, id)) };
  });

  app.post("/:id/contact-events", work, async (req) => {
    const { id } = idParams.parse(req.params);
    const { kind } = contactBody.parse(req.body);
    const user = req.user as SessionUser;
    await recordContactEvent(app.db, user, id, kind);
    return getLeadDetail(app.db, user, id);
  });
}
