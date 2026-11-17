import { randomUUID } from "node:crypto";
import type { ReminderMessage, SendResult, WhatsAppProvider } from "./provider.js";

/** Sends nothing. Used in development and in every automated test. Keeps what it "sent" for assertions. */
export class MockProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly sent: ReminderMessage[] = [];
  /** Set to make the next sends fail, to exercise error handling. */
  failWith: string | null = null;

  async send(message: ReminderMessage): Promise<SendResult> {
    if (this.failWith) return { status: "FAILED", providerMessageId: null, error: this.failWith };
    this.sent.push(message);
    return { status: "SENT", providerMessageId: `mock-${randomUUID()}` };
  }
}
