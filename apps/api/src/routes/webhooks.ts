import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { reminderLog } from "../db/schema.js";

/** How far along a message is. A late or repeated webhook must never move a message backwards. */
const RANK: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const FROM_META: Record<string, string> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function verifySignature(
  appSecret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(header.slice("sha256=".length), expected);
}

interface StatusEvent {
  id?: unknown;
  status?: unknown;
  errors?: { code?: number; title?: string }[];
}

/**
 * Meta's delivery-status webhook. Only mounted when WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are
 * set (i.e. WHATSAPP_PROVIDER=meta). Public by nature, so the HMAC signature over the RAW body is the
 * only thing that makes a request trustworthy, and it is checked before the JSON is even parsed.
 */
export async function webhookRoutes(app: FastifyInstance) {
  const secret = app.config.WHATSAPP_APP_SECRET;
  const verifyToken = app.config.WHATSAPP_VERIFY_TOKEN;
  if (!secret || !verifyToken) return;

  // Keep the exact bytes Meta signed. Scoped to this plugin: no other route is affected.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: 1024 * 1024 },
    (req, body, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      done(null, body);
    },
  );

  // One-time subscription handshake when the webhook URL is registered in the Meta dashboard.
  app.get("/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (
      q["hub.mode"] === "subscribe" &&
      typeof q["hub.verify_token"] === "string" &&
      safeEqual(q["hub.verify_token"], verifyToken) &&
      q["hub.challenge"]
    )
      return reply.type("text/plain").send(q["hub.challenge"]);
    return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Verification failed" } });
  });

  app.post("/whatsapp", async (req, reply) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    if (!verifySignature(secret, raw, req.headers["x-hub-signature-256"] as string | undefined))
      return reply
        .status(401)
        .send({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } });

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Invalid JSON" } });
    }

    const events: StatusEvent[] = [];
    const entries = (
      payload as { entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[] } | null
    )?.entry;
    for (const e of Array.isArray(entries) ? entries : [])
      for (const c of Array.isArray(e?.changes) ? e.changes : [])
        for (const s of Array.isArray(c?.value?.statuses) ? c.value.statuses : []) events.push(s);

    let updated = 0;
    for (const ev of events) {
      const next = typeof ev.status === "string" ? FROM_META[ev.status] : undefined;
      if (typeof ev.id !== "string" || !next) continue; // other kinds of event (incoming messages etc.) are ignored
      // Forward-only: apply when the stored status ranks below the new one. FAILED only replaces a
      // message that has not yet been delivered. A single guarded UPDATE, so concurrent webhooks cannot regress it.
      const allowedFrom =
        next === "FAILED"
          ? ["PENDING", "SENT"]
          : Object.keys(RANK).filter((s) => (RANK[s] as number) < (RANK[next] as number));
      const rows = await app.db
        .update(reminderLog)
        .set({ status: next })
        .where(
          and(eq(reminderLog.providerMessageId, ev.id), inArray(reminderLog.status, allowedFrom)),
        )
        .returning({ id: reminderLog.id });
      updated += rows.length;
      if (next === "FAILED" && rows.length)
        app.log.warn(
          {
            providerMessageId: ev.id,
            errors: ev.errors?.map((e) => ({ code: e.code, title: e.title })),
          },
          "whatsapp delivery failed",
        );
    }
    // Always 200 for a correctly signed request, so Meta does not keep retrying events we don't track.
    return { received: events.length, updated };
  });
}
