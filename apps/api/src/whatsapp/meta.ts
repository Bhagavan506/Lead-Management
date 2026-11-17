import type { ReminderMessage, SendResult, WhatsAppProvider } from "./provider.js";

export interface MetaConfig {
  /** e.g. https://graph.facebook.com/v21.0 (overridable so tests can point at a simulated API). */
  apiBase: string;
  phoneNumberId: string;
  accessToken: string;
  /** Name of the APPROVED template whose body is TEMPLATE_BODY (three text variables). */
  templateName: string;
  templateLang: string;
  timeoutMs?: number;
}

/**
 * WhatsApp Business Cloud API (Meta). Sends the approved template with the three variables.
 *
 * NOT VERIFIED AGAINST THE LIVE API: written to Meta's documented request/response shapes and tested
 * against a simulated server only (see docs/WHATSAPP.md for the go-live checklist).
 *
 * Failure policy: a send is attempted ONCE. Retrying a request whose outcome is unknown (timeout,
 * dropped connection) could message the employee twice, so errors become a FAILED log row and an
 * admin decides whether to use "Send now". The access token never appears in errors or logs.
 */
export class MetaProvider implements WhatsAppProvider {
  readonly name = "meta";

  constructor(
    private readonly cfg: MetaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(m: ReminderMessage): Promise<SendResult> {
    const url = `${this.cfg.apiBase.replace(/\/+$/, "")}/${encodeURIComponent(this.cfg.phoneNumberId)}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: m.to.replace(/\D/g, ""), // Meta wants digits only, no "+"
      type: "template",
      template: {
        name: this.cfg.templateName,
        language: { code: this.cfg.templateLang },
        components: [
          { type: "body", parameters: m.params.map((text) => ({ type: "text", text })) },
        ],
      },
    };

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.cfg.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return fail(
        timedOut
          ? "Timed out waiting for WhatsApp (the message may or may not have been sent)"
          : "Could not reach WhatsApp",
      );
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }

    if (!res.ok) {
      const e = (
        json as {
          error?: { message?: string; code?: number; error_data?: { details?: string } };
        } | null
      )?.error;
      const detail = e?.error_data?.details ?? e?.message ?? "no details";
      return fail(
        `WhatsApp rejected the message (HTTP ${res.status}${e?.code ? `, code ${e.code}` : ""}): ${detail}`,
      );
    }
    const id = (json as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
    if (typeof id !== "string" || !id)
      return fail("Unexpected response from WhatsApp (no message id)");
    return { status: "SENT", providerMessageId: id };
  }
}

const fail = (error: string): SendResult => ({ status: "FAILED", providerMessageId: null, error });
