import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeMeta } from "../test/fake-meta.js";
import { MetaProvider } from "./meta.js";

const TOKEN = "EAAB-super-secret-token";
const msg = {
  to: "+919820000001",
  params: ["Priya", "2 follow-ups", "Aarav Mehta (overdue), Sara Khan"] as const,
  text: "t",
};

describe("MetaProvider against a simulated Meta API (NOT verified against the live API)", () => {
  let fake: Awaited<ReturnType<typeof startFakeMeta>>;
  const make = (over: Partial<ConstructorParameters<typeof MetaProvider>[0]> = {}) =>
    new MetaProvider({
      apiBase: fake.base,
      phoneNumberId: "1234567890",
      accessToken: TOKEN,
      templateName: "follow_up_reminder",
      templateLang: "en",
      ...over,
    });

  beforeAll(async () => {
    fake = await startFakeMeta();
  });
  afterAll(() => fake.close());
  beforeEach(() => {
    fake.requests.length = 0;
    fake.reply = () => ({ status: 200, json: { messages: [{ id: "wamid.ABC" }] } });
  });

  it("posts the approved template with three text variables, digits-only recipient and a bearer token", async () => {
    const r = await make().send(msg);
    expect(r).toEqual({ status: "SENT", providerMessageId: "wamid.ABC" });
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v21.0/1234567890/messages");
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers["content-type"]).toContain("application/json");
    expect(req.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919820000001",
      type: "template",
      template: {
        name: "follow_up_reminder",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Priya" },
              { type: "text", text: "2 follow-ups" },
              { type: "text", text: "Aarav Mehta (overdue), Sara Khan" },
            ],
          },
        ],
      },
    });
  });

  it("uses the configured template language and tolerates a trailing slash on the base URL", async () => {
    await make({ templateLang: "en_GB", apiBase: `${fake.base}/` }).send(msg);
    expect(fake.requests[0]!.url).toBe("/v21.0/1234567890/messages");
    expect(fake.requests[0]!.body.template.language.code).toBe("en_GB");
  });

  it("an API error becomes FAILED with Meta's reason and code, and never exposes the token", async () => {
    fake.reply = () => ({
      status: 400,
      json: {
        error: {
          message: "(#132000) Number of parameters does not match",
          code: 132000,
          error_data: {
            details:
              "body: number of localizable_params (3) does not match the expected number of params (2)",
          },
        },
      },
    });
    const r = await make().send(msg);
    expect(r.status).toBe("FAILED");
    expect(r.providerMessageId).toBeNull();
    const text = (r as { error: string }).error;
    expect(text).toContain("HTTP 400");
    expect(text).toContain("132000");
    expect(text).toContain("number of localizable_params");
    expect(text).not.toContain(TOKEN);
  });

  it.each([
    [401, { error: { message: "Invalid OAuth access token", code: 190 } }],
    [429, { error: { message: "Rate limit hit", code: 4 } }],
    [500, { error: { message: "Server error" } }],
    [502, null],
  ])("HTTP %s is FAILED (and a non-JSON error page does not crash)", async (status, json) => {
    fake.reply = () => ({ status, json: json ?? undefined });
    const r = await make().send(msg);
    expect(r).toMatchObject({ status: "FAILED", providerMessageId: null });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect((r as { error: string }).error).toContain(`HTTP ${status}`);
  });

  it("a 200 without a message id is FAILED, not silently 'sent'", async () => {
    for (const json of [
      {},
      { messages: [] },
      { messages: [{}] },
      { messages: [{ id: 5 }] },
      null,
    ]) {
      fake.reply = () => ({ status: 200, json: json ?? undefined });
      expect(await make().send(msg)).toMatchObject({ status: "FAILED" });
    }
  });

  it("a dropped connection is FAILED, and a send is attempted exactly once (no retry that could double-send)", async () => {
    fake.reply = () => ({ drop: true });
    const r = await make().send(msg);
    expect(r).toMatchObject({ status: "FAILED" });
    expect((r as { error: string }).error).toContain("Could not reach WhatsApp");
    expect(fake.requests).toHaveLength(1);
  });

  it("a server that never answers times out as FAILED and says the outcome is unknown", async () => {
    fake.reply = () => ({ hang: true });
    const started = Date.now();
    const r = await make({ timeoutMs: 150 }).send(msg);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r).toMatchObject({ status: "FAILED" });
    expect((r as { error: string }).error).toContain("may or may not have been sent");
    expect(fake.requests).toHaveLength(1);
  });

  it("an unreachable host is FAILED", async () => {
    const r = await make({ apiBase: "http://127.0.0.1:1/v21.0" }).send(msg);
    expect(r).toMatchObject({ status: "FAILED" });
  });

  it("a wrong phone-number id is part of the URL, escaped", async () => {
    await make({ phoneNumberId: "12/34?x" }).send(msg);
    expect(fake.requests[0]!.url).toBe("/v21.0/12%2F34%3Fx/messages");
  });
});
