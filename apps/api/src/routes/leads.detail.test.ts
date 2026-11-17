import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createTestApp, loginCookie, type TestApp } from "../test/app.js";

describe.skipIf(!hasDb)("GET /api/leads/:id", () => {
  let ctx: TestApp;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const leadIds: Record<string, string> = {}; // by phone suffix name
  let all: { id: string; name: string; ownerId: string | null; phone: string }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const e of ["admin", "priya", "rohan", "anita"]) {
      cookies[e] = (await loginCookie(ctx.app, `${e}@demo.com`)).cookie;
      userIds[e] = (
        (
          await ctx.t.db
            .select()
            .from(users)
            .where(eq(users.email, `${e}@demo.com`))
        )[0] as { id: string }
      ).id;
    }
    all = await ctx.t.db.select().from(leads);
    for (const l of all) leadIds[l.name] = l.id;
  });
  afterAll(() => ctx.close());

  const get = (as: string | null, id: string) =>
    ctx.app.inject({
      method: "GET",
      url: `/api/leads/${id}`,
      headers: as ? { cookie: cookies[as] as string } : {},
    });

  it("returns the lead with its full timeline, newest first, for the owner", async () => {
    const res = await get("priya", leadIds["Aarav Mehta"] as string);
    expect(res.statusCode).toBe(200);
    const { lead, timeline } = res.json();
    expect(lead).toMatchObject({
      name: "Aarav Mehta",
      company: "Northwind Traders",
      phone: "+919810000001",
      status: "QUALIFIED",
      ownerName: "Priya Sharma",
      isStale: false,
    });
    expect(timeline).toHaveLength(5); // upload + call + 2 status changes + note
    const times = timeline.map((t: { createdAt: string }) => Date.parse(t.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times); // newest first
    expect(timeline.at(-1)).toMatchObject({
      text: "Uploaded by Admin",
      actorName: "Admin",
      type: "UPLOADED",
    });
    expect(timeline.map((t: { text: string }) => t.text)).toEqual(
      expect.arrayContaining([
        "Call: Answered",
        "Status: Contacted → Qualified",
        "Note: Wants pricing for 20 seats",
      ]),
    );
  });

  it("lets an admin read any lead, including unassigned and closed ones", async () => {
    for (const name of ["Imran Ali", "Kabir Singh", "Nisha Rao", "Dev Patel"]) {
      const res = await get("admin", leadIds[name] as string);
      expect(res.statusCode, name).toBe(200);
      expect(res.json().lead.name).toBe(name);
    }
    const nisha = (await get("admin", leadIds["Nisha Rao"] as string)).json().lead;
    expect(nisha).toMatchObject({ status: "LOST", lostReason: "WRONG_CONTACT", isStale: false });
    expect((await get("admin", leadIds["Imran Ali"] as string)).json().lead).toMatchObject({
      ownerId: null,
      ownerName: null,
      isStale: true,
    });
  });

  it("returns 404 for another employee's lead, identical to a lead that does not exist", async () => {
    const foreign = await get("rohan", leadIds["Aarav Mehta"] as string);
    const missing = await get("rohan", "00000000-0000-4000-8000-000000000000");
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json()); // no way to tell "exists but not yours" apart
    expect(foreign.body).not.toContain("Aarav");
    expect(foreign.body).not.toContain("Priya");
  });

  it("hides the unassigned pool from employees", async () => {
    for (const e of ["priya", "rohan", "anita"]) {
      expect((await get(e, leadIds["Imran Ali"] as string)).statusCode).toBe(404);
    }
  });

  it("allows exactly the owner: every employee × every lead (IDOR sweep)", async () => {
    for (const me of ["priya", "rohan", "anita"]) {
      for (const l of all) {
        const res = await get(me, l.id);
        expect(res.statusCode, `${me} -> ${l.name}`).toBe(l.ownerId === userIds[me] ? 200 : 404);
        if (res.statusCode === 404) expect(res.body).not.toContain(l.name);
      }
    }
  });

  it("follows ownership changes immediately", async () => {
    const id = leadIds["Meera Iyer"] as string; // rohan's
    expect((await get("rohan", id)).statusCode).toBe(200);
    expect((await get("anita", id)).statusCode).toBe(404);
    await ctx.t.db.update(leads).set({ ownerId: userIds.anita }).where(eq(leads.id, id));
    expect((await get("rohan", id)).statusCode).toBe(404);
    expect((await get("anita", id)).statusCode).toBe(200);
    await ctx.t.db.update(leads).set({ ownerId: userIds.rohan }).where(eq(leads.id, id));
  });

  it("does not expose internals: no hashes, no activity meta, no other users' ids beyond actors", async () => {
    const res = await get("admin", leadIds["Aarav Mehta"] as string);
    expect(res.body).not.toMatch(/argon2|passwordHash|password_hash|"meta"/i);
  });

  it("rejects bad ids, anonymous callers and unchanged temporary passwords", async () => {
    expect((await get("priya", "not-a-uuid")).statusCode).toBe(422);
    expect((await get(null, leadIds["Aarav Mehta"] as string)).statusCode).toBe(401);
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, userIds.priya as string));
    expect((await get("priya", leadIds["Aarav Mehta"] as string)).statusCode).toBe(403);
    await ctx.t.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, userIds.priya as string));
  });

  it("marks a stale lead as stale", async () => {
    expect((await get("rohan", leadIds["Meera Iyer"] as string)).json().lead.isStale).toBe(true);
  });
});
