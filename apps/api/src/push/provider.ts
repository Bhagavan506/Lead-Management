import type { PushNotifier } from "./notifier.js";
import type { ReminderMessage, SendResult, WhatsAppProvider } from "../whatsapp/provider.js";

/** Delivers the daily reminder as a browser push notification to the employee's devices. */
export class PushProvider implements WhatsAppProvider {
  readonly name = "push";
  readonly usesPhone = false;

  constructor(private readonly notifier: PushNotifier) {}

  async canDeliver(employeeId: string): Promise<boolean> {
    return (await this.notifier.deviceCount(employeeId)) > 0;
  }

  async send(message: ReminderMessage): Promise<SendResult> {
    const r = await this.notifier.sendToUser(message.employeeId, {
      title: `Follow-ups due: ${message.params[1]}`,
      body: message.params[2],
      url: "/app/follow-ups",
      tag: "follow-up-reminder",
    });
    if (r.sent > 0) return { status: "SENT", providerMessageId: null };
    return {
      status: "FAILED",
      providerMessageId: null,
      error: r.error ?? "No device accepted the notification",
    };
  }
}
