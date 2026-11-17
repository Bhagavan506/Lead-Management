import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
type Reply = { status?: number; json?: unknown; hang?: boolean; drop?: boolean };

/**
 * A stand-in for graph.facebook.com that speaks the documented Cloud API shapes. It lets the Meta
 * provider and webhook be tested for real over HTTP, with no network and no credentials.
 */
export async function startFakeMeta() {
  const requests: FakeRequest[] = [];
  let n = 0;
  const fake = {
    requests,
    /** Override per test. Default: accept and return a message id. */
    reply: (): Reply => ({
      status: 200,
      json: {
        messaging_product: "whatsapp",
        contacts: [{ wa_id: "x" }],
        messages: [{ id: `wamid.FAKE${++n}` }],
      },
    }),
    base: "",
    server: undefined as unknown as Server,
    close: () =>
      new Promise<void>((r) => (fake.server.closeAllConnections?.(), fake.server.close(() => r()))),
  };
  fake.server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        /* leave null */
      }
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const r = fake.reply();
      if (r.hang) return; // never answer: exercises the timeout
      if (r.drop) return req.socket.destroy();
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
  fake.base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/v21.0`;
  return fake;
}
