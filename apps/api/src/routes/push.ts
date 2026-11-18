import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { pushSubscriptions } from "../db/schema.js";
import { AppError } from "../errors.js";
import type { SessionUser } from "../plugins/auth.js";

const subscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().url().max(2000) });

/** Browser push: employees register their devices here. Admins do not receive pushes. */
export async function pushRoutes(app: FastifyInstance) {
  const employee = { preHandler: app.guard("EMPLOYEE") };
  const notifier = () => {
    if (!app.push) throw new AppError(404, "PUSH_UNAVAILABLE", "Push notifications are not set up");
    return app.push;
  };

  // What the browser needs to subscribe. 404 when the server has no VAPID keys.
  app.get("/public-key", employee, async () => ({ publicKey: notifier().publicKey }));

  app.post("/subscribe", employee, async (req) => {
    const body = subscribeBody.parse(req.body);
    const user = req.user as SessionUser;
    notifier();
    const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 300);
    // Same device again (or a device now used by someone else): the row moves to this employee.
    await app.db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
      });
    return { devices: await notifier().deviceCount(user.id) };
  });

  app.post("/unsubscribe", employee, async (req) => {
    const { endpoint } = unsubscribeBody.parse(req.body);
    const user = req.user as SessionUser;
    const rows = await app.db
      .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    // Only your own device; anything else is "already gone" as far as the caller can tell.
    if (rows.some((r) => r.userId === user.id))
      await app.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return { devices: app.push ? await app.push.deviceCount(user.id) : 0 };
  });

  // "Send me a test" so an employee can see it works on this device.
  app.post("/test", employee, async (req) => {
    const user = req.user as SessionUser;
    const r = await notifier().sendToUser(user.id, {
      title: "Leadbook notifications are on",
      body: "You will be told when follow-ups are due and when a lead is assigned to you.",
      url: "/app/follow-ups",
      tag: "test",
    });
    if (r.sent === 0)
      throw new AppError(
        409,
        "NO_DEVICE",
        r.failed > 0
          ? "Could not reach your device. Turn notifications off and on again."
          : "No device is registered",
      );
    return r;
  });
}
