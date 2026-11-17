import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { leads, users } from "../db/schema.js";
import { createTestApp, loginCookie, type TestApp } from "./app.js";

/** A seeded app plus logged-in cookies, user ids and lead ids by name, for route tests. */
export async function createWorld(
  env: Record<string, string> = {},
  opts: { realProvider?: boolean; beforeReady?: (app: FastifyInstance) => void } = {},
) {
  const ctx: TestApp = await createTestApp(env, undefined, opts);
  const cookies: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const lid: Record<string, string> = {};
  for (const e of ["admin", "priya", "rohan", "anita"]) {
    cookies[e] = (await loginCookie(ctx.app, `${e}@demo.com`)).cookie;
    uid[e] = (
      (
        await ctx.t.db
          .select()
          .from(users)
          .where(eq(users.email, `${e}@demo.com`))
      )[0] as { id: string }
    ).id;
  }
  for (const l of await ctx.t.db.select().from(leads)) lid[l.name] = l.id;

  const call = (
    as: string | null,
    method: "GET" | "POST" | "PATCH" | "PUT",
    url: string,
    payload?: unknown,
  ) =>
    ctx.app.inject({
      method,
      url,
      headers: as ? { cookie: cookies[as] as string } : {},
      payload: payload as object,
    });
  const lead = async (name: string) =>
    (
      await ctx.t.db
        .select()
        .from(leads)
        .where(eq(leads.id, lid[name] as string))
    )[0] as typeof leads.$inferSelect;
  return { ctx, cookies, uid, lid, call, lead };
}
export type World = Awaited<ReturnType<typeof createWorld>>;
