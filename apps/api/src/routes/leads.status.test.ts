import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, count, eq } from "drizzle-orm";
import { activities, leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

describe.skipIf(!hasDb)("PATCH /api/leads/:id/status", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.ctx.close());

  const setStatus = (as: string | null, name: string, body: unknown) =>
    w.call(as, "PATCH", `/api/leads/${w.lid[name]}/status`, body);
  const actCount = async (name: string) =>
    (
      (
        await w.ctx.t.db
          .select({ n: count() })
          .from(activities)
          .where(eq(activities.leadId, w.lid[name] as string))
      )[0] as { n: number }
    ).n;

  it("changes status and records 'Status: A → B' by the employee", async () => {
    const res = await setStatus("priya", "Aarav Mehta", { status: "PROPOSAL" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, lead: { status: "PROPOSAL" } });
    expect(res.json().timeline[0]).toMatchObject({
      text: "Status: Qualified → Proposal",
      type: "STATUS_CHANGE",
      actorName: "Priya Sharma",
    });
  });

  it("rejects Lost without a reason with 422 and changes nothing (rule 5)", async () => {
    const before = await w.lead("Sara Khan");
    const n = await actCount("Sara Khan");
    for (const body of [{ status: "LOST" }, { status: "LOST", lostReason: null }]) {
      const res = await setStatus("priya", "Sara Khan", body);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe(
        body.lostReason === undefined ? "LOST_REASON_REQUIRED" : "VALIDATION_ERROR",
      );
    }
    expect(await w.lead("Sara Khan")).toEqual(before);
    expect(await actCount("Sara Khan")).toBe(n);
  });

  it("rejects an unknown reason, an unknown status, and a reason on a non-Lost status", async () => {
    for (const body of [
      { status: "LOST", lostReason: "BORED" },
      { status: "ARCHIVED" },
      {},
      { status: "WON", lostReason: "PRICE" },
      { status: "CONTACTED", lostReason: "OTHER" },
    ]) {
      expect((await setStatus("priya", "Sara Khan", body)).statusCode, JSON.stringify(body)).toBe(
        422,
      );
    }
    expect((await w.lead("Sara Khan")).status).toBe("CONTACTED");
  });

  it.each([
    ["PRICE", "Price"],
    ["NO_RESPONSE", "No response"],
    ["CHOSE_COMPETITOR", "Chose competitor"],
    ["WRONG_CONTACT", "Wrong contact"],
    ["NOT_INTERESTED", "Not interested"],
    ["OTHER", "Other"],
  ])("marks Lost with reason %s, clears the follow-up and records it", async (code, label) => {
    await w.ctx.t.db
      .update(leads)
      .set({ status: "CONTACTED", lostReason: null, followUpDate: "2030-01-01" })
      .where(eq(leads.id, w.lid["Sara Khan"] as string));
    const res = await setStatus("priya", "Sara Khan", { status: "LOST", lostReason: code });
    expect(res.statusCode).toBe(200);
    expect(res.json().lead).toMatchObject({ status: "LOST", lostReason: code, followUpDate: null });
    expect(res.json().timeline[0].text).toBe(`Status: Contacted → Lost (${label})`);
  });

  it("reopening a Lost lead clears the reason (rule 5)", async () => {
    await setStatus("priya", "Sara Khan", { status: "LOST", lostReason: "PRICE" });
    const res = await setStatus("priya", "Sara Khan", { status: "CONTACTED" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lead).toMatchObject({ status: "CONTACTED", lostReason: null });
    expect(res.json().timeline[0].text).toBe("Status: Lost → Contacted");
    expect((await w.lead("Sara Khan")).lostReason).toBeNull();
  });

  it("Won clears the follow-up date", async () => {
    await w.ctx.t.db
      .update(leads)
      .set({ followUpDate: "2030-01-01" })
      .where(eq(leads.id, w.lid["Aarav Mehta"] as string));
    const res = await setStatus("priya", "Aarav Mehta", { status: "WON" });
    expect(res.json().lead).toMatchObject({ status: "WON", followUpDate: null });
    expect(
      (await setStatus("priya", "Aarav Mehta", { status: "QUALIFIED" })).json().lead.status,
    ).toBe("QUALIFIED"); // can reopen a Won lead
  });

  it("is a no-op, with no history, when nothing changes", async () => {
    const n = await actCount("Aarav Mehta");
    expect((await setStatus("priya", "Aarav Mehta", { status: "QUALIFIED" })).json().changed).toBe(
      false,
    );
    expect(await actCount("Aarav Mehta")).toBe(n);
    await setStatus("priya", "Sara Khan", { status: "LOST", lostReason: "PRICE" });
    const m = await actCount("Sara Khan");
    expect(
      (await setStatus("priya", "Sara Khan", { status: "LOST", lostReason: "PRICE" })).json()
        .changed,
    ).toBe(false);
    expect(await actCount("Sara Khan")).toBe(m);
    // changing only the reason is a real change and is recorded
    expect(
      (await setStatus("priya", "Sara Khan", { status: "LOST", lostReason: "OTHER" })).json()
        .timeline[0].text,
    ).toBe("Status: Lost → Lost (Other)");
  });

  it("counts as activity: a stale lead stops being stale", async () => {
    expect(
      (await w.call("rohan", "GET", `/api/leads/${w.lid["Meera Iyer"]}`)).json().lead.isStale,
    ).toBe(true);
    const res = await setStatus("rohan", "Meera Iyer", { status: "CONTACTED" });
    expect(res.json().lead.isStale).toBe(false);
  });

  it("only the owner may change status (rule 4)", async () => {
    const before = await w.lead("Dev Patel");
    const n = await actCount("Dev Patel");
    const other = await setStatus("priya", "Dev Patel", { status: "WON" }); // Rohan's lead
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual((await setStatus("priya", "Dev Patel", { status: "WON" })).json());
    expect((await setStatus("admin", "Dev Patel", { status: "WON" })).statusCode).toBe(403);
    expect((await setStatus(null, "Dev Patel", { status: "WON" })).statusCode).toBe(401);
    expect((await setStatus("priya", "Imran Ali", { status: "WON" })).statusCode).toBe(404); // unassigned
    const ghost = await w.call(
      "priya",
      "PATCH",
      "/api/leads/00000000-0000-4000-8000-000000000000/status",
      { status: "WON" },
    );
    expect(ghost.json()).toEqual(other.json()); // missing and foreign look identical
    expect(await w.lead("Dev Patel")).toEqual(before);
    expect(await actCount("Dev Patel")).toBe(n);
  });

  it("stops working the moment the lead is reassigned away", async () => {
    expect((await setStatus("rohan", "Dev Patel", { status: "QUALIFIED" })).statusCode).toBe(200);
    await w.call("admin", "POST", `/api/leads/${w.lid["Dev Patel"]}/assign`, {
      ownerId: w.uid.anita,
    });
    expect((await setStatus("rohan", "Dev Patel", { status: "PROPOSAL" })).statusCode).toBe(404);
    expect((await setStatus("anita", "Dev Patel", { status: "PROPOSAL" })).statusCode).toBe(200);
  });

  it("rejects bad ids and unchanged temporary passwords", async () => {
    expect(
      (await w.call("priya", "PATCH", "/api/leads/nope/status", { status: "WON" })).statusCode,
    ).toBe(422);
    await w.ctx.t.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.id, w.uid.priya as string));
    expect((await setStatus("priya", "Aarav Mehta", { status: "NEW" })).statusCode).toBe(403);
    await w.ctx.t.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, w.uid.priya as string));
  });

  it("serialises simultaneous changes: history forms one chain ending at the real status", async () => {
    const order = ["QUALIFIED", "PROPOSAL", "CONTACTED", "NEW", "PROPOSAL", "QUALIFIED"];
    const start = (await w.lead("Aarav Mehta")).status;
    const results = await Promise.all(
      order.map((status) => setStatus("priya", "Aarav Mehta", { status })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const rows = (
      await w.ctx.t.db
        .select()
        .from(activities)
        .where(eq(activities.leadId, w.lid["Aarav Mehta"] as string))
        .orderBy(asc(activities.createdAt), asc(activities.id))
    )
      .filter((a) => a.type === "STATUS_CHANGE")
      .slice(-results.filter((r) => r.json().changed).length);
    let at = start;
    for (const r of rows) {
      const m = r.meta as { from: string; to: string };
      expect(m.from).toBe(at);
      at = m.to as typeof at;
    }
    expect(at).toBe((await w.lead("Aarav Mehta")).status);
  });
});
