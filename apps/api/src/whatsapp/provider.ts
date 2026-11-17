/**
 * What the reminder job needs from a WhatsApp sender. The job writes the ReminderLog row itself
 * (so every provider is logged the same way); a provider only delivers one message and reports back.
 */
export interface ReminderMessage {
  /** Recipient in E.164 (+919800000001). */
  to: string;
  /** The three template variables, in order: first name, "N follow-ups", comma-separated lead names. */
  params: readonly [string, string, string];
  /** The message exactly as the employee will read it (the template with the variables filled in). */
  text: string;
}

export type SendResult =
  | { status: "SENT"; providerMessageId: string | null }
  | { status: "FAILED"; providerMessageId: null; error: string };

export interface WhatsAppProvider {
  readonly name: string;
  /** Must not throw for delivery problems: return FAILED with a reason instead. */
  send(message: ReminderMessage): Promise<SendResult>;
}
