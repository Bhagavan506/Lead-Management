import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leads } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

describe.skipIf(!hasDb)("follow-up list filter and employee summary (8.1, 8.3)", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
    // known data: Priya has Aarav and Sara
    const set = (name: string, p: Partial<typeof leads.$inferInsert>) =>
      w.ctx.t.db
        .update(leads)
        .set(p)
        .where(eq(leads.id, w.lid[name] as string));
    await set("Aarav Mehta", { status: "QUALIFIED", followUpDate: dateInTz("Asia/Kolkata", -2) }); // overdue
    await set("Sara Khan", { status: "CONTACTED", followUpDate: dateInTz("Asia/Kolkata", 3) }); // upcoming
    await set("Dev Patel", { status: "CONTACTED", followUpDate: dateInTz("Asia/Kolkata", 0) }); // Rohan, due today
  });
  afterAll(() => w.ctx.close());

  const today = () => dateInTz("Asia/Kolkata", 0);
  const names = (r: { json(): { leads: { name: string }[] } }) => r.json().leads.map((l) => l.name);

  it("scheduled: my open leads with a date, soonest first, nothing of anyone else's", async () => {
    const res = await w.call("priya", "GET", "/api/leads?followUp=scheduled");
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Aarav Mehta", "Sara Khan"]);
    expect(
      (await w.call("rohan", "GET", "/api/leads?followUp=scheduled"))
        .json()
        .leads.map((l: { name: string }) => l.name),
    ).toContain("Dev Patel");
    expect(names(await w.call("rohan", "GET", "/api/leads?followUp=scheduled"))).not.toContain(
      "Aarav Mehta",
    );
  });

  it("due: on or before today in the app timezone, so today counts and tomorrow does not", async () => {
    expect(names(await w.call("priya", "GET", "/api/leads?followUp=due"))).toEqual(["Aarav Mehta"]);
    expect(names(await w.call("rohan", "GET", "/api/leads?followUp=due"))).toContain("Dev Patel");
    await w.ctx.t.db
      .update(leads)
      .set({ followUpDate: dateInTz("Asia/Kolkata", 1) })
      .where(eq(leads.id, w.lid["Dev Patel"] as string));
    expect(names(await w.call("rohan", "GET", "/api/leads?followUp=due"))).not.toContain(
      "Dev Patel",
    );
    await w.ctx.t.db
      .update(leads)
      .set({ followUpDate: today() })
      .where(eq(leads.id, w.lid["Dev Patel"] as string));
  });

  it("closed leads never count, even if a date is still stored", async () => {
    await w.ctx.t.db
      .update(leads)
      .set({ status: "WON" })
      .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
    expect(names(await w.call("priya", "GET", "/api/leads?followUp=scheduled"))).toEqual([
      "Sara Khan",
    ]);
    expect(names(await w.call("priya", "GET", "/api/leads?followUp=due"))).toEqual([]);
    await w.ctx.t.db
      .update(leads)
      .set({ status: "QUALIFIED" })
      .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
  });

  it("combines with the other filters and pagination", async () => {
    const res = await w.call("priya", "GET", "/api/leads?followUp=scheduled&pageSize=1&page=2");
    expect(res.json()).toMatchObject({ total: 2, totalPages: 2, page: 2 });
    expect(names(res)).toEqual(["Sara Khan"]);
    expect(
      names(await w.call("priya", "GET", "/api/leads?followUp=scheduled&status=CONTACTED")),
    ).toEqual(["Sara Khan"]);
  });

  it("an admin can use the filter too, across all owners", async () => {
    const all = names(await w.call("admin", "GET", "/api/leads?followUp=scheduled&pageSize=100"));
    expect(all).toEqual(expect.arrayContaining(["Aarav Mehta", "Sara Khan", "Dev Patel"]));
  });

  it("rejects an unknown filter value", async () => {
    expect((await w.call("priya", "GET", "/api/leads?followUp=soon")).statusCode).toBe(422);
  });

  describe("GET /api/leads/summary", () => {
    it("counts only the signed-in employee's own leads", async () => {
      const raw = (await w.ctx.t.db.select().from(leads)).filter((l) => l.ownerId === w.uid.priya);
      const res = await w.call("priya", "GET", "/api/leads/summary");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        total: raw.length,
        notContacted: raw.filter((l) => l.status === "NEW").length,
        followUpsDue: raw.filter(
          (l) =>
            l.status !== "WON" &&
            l.status !== "LOST" &&
            l.followUpDate &&
            l.followUpDate <= today(),
        ).length,
        won: raw.filter((l) => l.status === "WON").length,
        today: today(),
      });
      expect(res.json().followUpsDue).toBe(1);
    });

    it("differs per employee (no shared numbers)", async () => {
      const [a, b] = await Promise.all(
        ["priya", "rohan"].map((e) => w.call(e, "GET", "/api/leads/summary")),
      );
      const raw = await w.ctx.t.db.select().from(leads);
      expect((b as { json(): { total: number } }).json().total).toBe(
        raw.filter((l) => l.ownerId === w.uid.rohan).length,
      );
      expect((a as { json(): { total: number } }).json().total).toBe(
        raw.filter((l) => l.ownerId === w.uid.priya).length,
      );
    });

    it("is employee-only: admin 403, anonymous 401", async () => {
      expect((await w.call("admin", "GET", "/api/leads/summary")).statusCode).toBe(403);
      expect((await w.call(null, "GET", "/api/leads/summary")).statusCode).toBe(401);
    });
  });
});
