import { eq, inArray } from "drizzle-orm";
import * as webpush from "web-push";
import type { Db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification goes, inside the app. */
  url: string;
  /** Same tag = the newer notification replaces the older one. */
  tag?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  error?: string;
}

/** The one call that talks to the push services. Replaced in tests. */
export type WebPushSend = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Sends a notification to every device an employee has turned notifications on for. A device whose
 * push service says it is gone (404/410) is forgotten, so dead subscriptions do not pile up.
 */
export class PushNotifier {
  readonly publicKey: string;
  private readonly sendOne: WebPushSend;

  constructor(
    private readonly db: Db,
    vapid: VapidKeys,
    sendOne?: WebPushSend,
  ) {
    this.publicKey = vapid.publicKey;
    this.sendOne =
      sendOne ??
      ((sub, payload) =>
        webpush.sendNotification(sub, payload, {
          vapidDetails: {
            subject: vapid.subject,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
          TTL: 12 * 3600, // a reminder is useless after half a day
        }));
  }

  async deviceCount(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    return rows.length;
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<PushResult> {
    const subs = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    const body = JSON.stringify(payload);
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    let error: string | undefined;
    for (const s of subs) {
      try {
        await this.sendOne(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        failed++;
        error = status ? `Push service answered ${status}` : (e as Error).message;
      }
    }
    if (gone.length > 0)
      await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    return { sent, failed, ...(error ? { error } : {}) };
  }

  /** Fire-and-forget for "something happened" notifications: never throws, never blocks the request. */
  notifyQuietly(userId: string, payload: PushPayload, log?: (e: unknown) => void): void {
    void this.sendToUser(userId, payload).catch((e) => log?.(e));
  }
}
