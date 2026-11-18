import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, count, eq } from "drizzle-orm";
import { activities, leads } from "../db/schema.js";
import { dateInTz } from "../lib/dates.js";
import { hasDb } from "../test/db.js";
import { createWorld, type World } from "../test/world.js";

describe.skipIf(!hasDb)("employee lead work: calls, notes, follow-up, contact events", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.ctx.close());

  const reset = (name: string, patch: Partial<typeof leads.$inferInsert>) =>
    w.ctx.t.db
      .update(leads)
      .set(patch)
      .where(eq(leads.id, w.lid[name] as string));
  const acts = async (name: string) =>
    w.ctx.t.db
      .select()
      .from(activities)
      .where(eq(activities.leadId, w.lid[name] as string))
      .orderBy(asc(activities.createdAt), asc(activities.id));
  const n = async (name: string) =>
    (
      (
        await w.ctx.t.db
          .select({ c: count() })
          .from(activities)
          .where(eq(activities.leadId, w.lid[name] as string))
      )[0] as { c: number }
    ).c;
  const post = (as: string | null, name: string, path: string, body: unknown) =>
    w.call(as, "POST", `/api/leads/${w.lid[name]}/${path}`, body);
  const patch = (as: string | null, name: string, path: string, body: unknown) =>
    w.call(as, "PATCH", `/api/leads/${w.lid[name]}/${path}`, body);
  const tomorrow = () => dateInTz("Asia/Kolkata", 1);
  const newest = async (name: string, k: number) => (await acts(name)).slice(-k).map((a) => a.text);

  describe("calls (4.2)", () => {
    it.each([
      ["ANSWERED", "Answered"],
      ["NO_ANSWER", "No answer"],
      ["BUSY", "Busy"],
      ["WRONG_NUMBER", "Wrong number"],
    ])("%s logs 'Call: %s' by the employee", async (outcome, label) => {
      await reset("Sara Khan", { status: "CONTACTED", followUpDate: null });
      const res = await post("priya", "Sara Khan", "calls", { outcome });
      expect(res.statusCode).toBe(200);
      const entry = (
        res.json().timeline as { text: string; type: string; actorName: string }[]
      ).find((t) => t.type === "CALL");
      expect(entry).toMatchObject({ text: `Call: ${label}`, actorName: "Priya Sharma" });
    });

    it("a call on a New lead moves it to Contacted, history in order Call → Status", async () => {
      await reset("Sara Khan", { status: "NEW", followUpDate: null });
      const res = await post("priya", "Sara Khan", "calls", { outcome: "ANSWERED" });
      expect(res.json().lead.status).toBe("CONTACTED");
      expect(await newest("Sara Khan", 2)).toEqual(["Call: Answered", "Status: New → Contacted"]);
    });

    it("a call on a non-New lead leaves the status alone", async () => {
      await reset("Aarav Mehta", { status: "PROPOSAL" });
      expect(
        (await post("priya", "Aarav Mehta", "calls", { outcome: "ANSWERED" })).json().lead.status,
      ).toBe("PROPOSAL");
    });

    it.each(["NO_ANSWER", "BUSY"])(
      "%s sets the follow-up to tomorrow (rule 8)",
      async (outcome) => {
        await reset("Sara Khan", { status: "CONTACTED", followUpDate: "2031-05-05" });
        const res = await post("priya", "Sara Khan", "calls", { outcome });
        expect(res.json().lead.followUpDate).toBe(tomorrow());
        expect((await newest("Sara Khan", 1))[0]).toBe(`Follow-up set to ${tomorrow()}`);
      },
    );

    it("New + No answer writes Call, Status, Follow-up in that order", async () => {
      await reset("Sara Khan", { status: "NEW", followUpDate: null });
      await post("priya", "Sara Khan", "calls", { outcome: "NO_ANSWER" });
      expect(await newest("Sara Khan", 3)).toEqual([
        "Call: No answer",
        "Status: New → Contacted",
        `Follow-up set to ${tomorrow()}`,
      ]);
    });

    it.each(["ANSWERED", "WRONG_NUMBER"])("%s does not touch the follow-up", async (outcome) => {
      await reset("Sara Khan", { status: "CONTACTED", followUpDate: "2031-05-05" });
      expect(
        (await post("priya", "Sara Khan", "calls", { outcome })).json().lead.followUpDate,
      ).toBe("2031-05-05");
    });

    it("logs the call but sets no follow-up on a closed lead", async () => {
      await reset("Aarav Mehta", { status: "WON", followUpDate: null });
      const res = await post("priya", "Aarav Mehta", "calls", { outcome: "NO_ANSWER" });
      expect(res.statusCode).toBe(200);
      expect(res.json().lead).toMatchObject({ status: "WON", followUpDate: null });
      expect((await newest("Aarav Mehta", 1))[0]).toBe("Call: No answer");
      await reset("Aarav Mehta", { status: "QUALIFIED" });
    });

    it("a call resets staleness", async () => {
      expect(
        (await w.call("rohan", "GET", `/api/leads/${w.lid["Meera Iyer"]}`)).json().lead.isStale,
      ).toBe(true);
      expect(
        (await post("rohan", "Meera Iyer", "calls", { outcome: "ANSWERED" })).json().lead.isStale,
      ).toBe(false);
    });

    it("rejects unknown outcomes and writes nothing", async () => {
      const before = await n("Sara Khan");
      for (const body of [{ outcome: "VOICEMAIL" }, {}, { outcome: "answered" }])
        expect((await post("priya", "Sara Khan", "calls", body)).statusCode).toBe(422);
      expect(await n("Sara Khan")).toBe(before);
    });
  });

  describe("notes (4.3)", () => {
    it("adds 'Note: text' and trims it", async () => {
      const res = await post("priya", "Sara Khan", "notes", { text: "  Wants a demo on Friday  " });
      expect(res.statusCode).toBe(200);
      expect(res.json().timeline[0]).toMatchObject({
        text: "Note: Wants a demo on Friday",
        type: "NOTE",
        actorName: "Priya Sharma",
      });
    });

    it("stores note text as plain data (no HTML interpretation)", async () => {
      const text = `<script>alert(1)</script> 'quote' "dq"; DROP TABLE leads;--`;
      expect((await post("priya", "Sara Khan", "notes", { text })).json().timeline[0].text).toBe(
        `Note: ${text}`,
      );
    });

    it("accepts 2000 characters, rejects 2001, empty and whitespace-only", async () => {
      expect(
        (await post("priya", "Sara Khan", "notes", { text: "x".repeat(2000) })).statusCode,
      ).toBe(200);
      const before = await n("Sara Khan");
      for (const text of ["x".repeat(2001), "", "   ", 5, null])
        expect((await post("priya", "Sara Khan", "notes", { text })).statusCode).toBe(422);
      expect(await n("Sara Khan")).toBe(before);
    });

    it("notes can be added to closed leads (history is still useful)", async () => {
      await reset("Aarav Mehta", { status: "LOST", lostReason: "PRICE" });
      expect(
        (await post("priya", "Aarav Mehta", "notes", { text: "Came back later" })).statusCode,
      ).toBe(200);
      await reset("Aarav Mehta", { status: "QUALIFIED", lostReason: null });
    });
  });

  describe("follow-up (4.3)", () => {
    it("sets, records, and clears the date", async () => {
      await reset("Sara Khan", { status: "CONTACTED", followUpDate: null });
      const set = await patch("priya", "Sara Khan", "follow-up", { date: "2031-07-09" });
      expect(set.json()).toMatchObject({ changed: true, lead: { followUpDate: "2031-07-09" } });
      expect(set.json().timeline[0]).toMatchObject({
        text: "Follow-up set to 2031-07-09",
        type: "FOLLOW_UP",
      });
      const clear = await patch("priya", "Sara Khan", "follow-up", { date: null });
      expect(clear.json()).toMatchObject({ changed: true, lead: { followUpDate: null } });
      expect(clear.json().timeline[0].text).toBe("Follow-up set to none");
    });

    it("accepts a past date (it shows as overdue)", async () => {
      expect(
        (await patch("priya", "Sara Khan", "follow-up", { date: "2020-01-01" })).json().lead
          .followUpDate,
      ).toBe("2020-01-01");
    });

    it("is a no-op when the date is unchanged", async () => {
      await patch("priya", "Sara Khan", "follow-up", { date: "2031-07-09" });
      const before = await n("Sara Khan");
      expect(
        (await patch("priya", "Sara Khan", "follow-up", { date: "2031-07-09" })).json().changed,
      ).toBe(false);
      await reset("Sara Khan", { followUpDate: null });
      const b2 = await n("Sara Khan");
      expect((await patch("priya", "Sara Khan", "follow-up", { date: null })).json().changed).toBe(
        false,
      );
      expect(await n("Sara Khan")).toBe(b2);
      expect(b2).toBeGreaterThan(0);
      expect(before).toBeGreaterThan(0);
    });

    it("rejects malformed and impossible dates", async () => {
      const before = await n("Sara Khan");
      for (const date of [
        "2031-13-01",
        "2031-02-30",
        "07/09/2031",
        "2031-7-9",
        "tomorrow",
        "",
        20310709,
        undefined,
      ])
        expect(
          (await patch("priya", "Sara Khan", "follow-up", { date })).statusCode,
          String(date),
        ).toBe(422);
      expect(await n("Sara Khan")).toBe(before);
    });

    it("refuses a date on a Won or Lost lead, but allows clearing", async () => {
      await reset("Aarav Mehta", { status: "WON", followUpDate: null });
      const res = await patch("priya", "Aarav Mehta", "follow-up", { date: "2031-07-09" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("LEAD_CLOSED");
      expect((await w.lead("Aarav Mehta")).followUpDate).toBeNull();
      await reset("Aarav Mehta", { status: "QUALIFIED" });
    });
  });

  describe("contact events (4.4)", () => {
    it.each([
      ["CALL", "Call started from app"],
      ["WHATSAPP", "WhatsApp chat opened"],
    ])("%s is recorded as a CONTACT_EVENT", async (kind, text) => {
      const res = await post("priya", "Sara Khan", "contact-events", { kind });
      expect(res.statusCode).toBe(200);
      expect(res.json().timeline[0]).toMatchObject({
        text,
        type: "CONTACT_EVENT",
        actorName: "Priya Sharma",
      });
    });

    it("does not change status or follow-up, but counts as activity", async () => {
      await reset("Sara Khan", { status: "NEW", followUpDate: "2031-07-09" });
      const res = await post("priya", "Sara Khan", "contact-events", { kind: "CALL" });
      expect(res.json().lead).toMatchObject({ status: "NEW", followUpDate: "2031-07-09" });
    });

    it("rejects unknown kinds", async () => {
      for (const body of [{ kind: "SMS" }, {}, { kind: "call" }])
        expect((await post("priya", "Sara Khan", "contact-events", body)).statusCode).toBe(422);
    });
  });

  describe("authorization (rule 3 and 4), all four endpoints", () => {
    const attempts: [string, "POST" | "PATCH", string, unknown][] = [
      ["call", "POST", "calls", { outcome: "NO_ANSWER" }],
      ["note", "POST", "notes", { text: "hello" }],
      ["follow-up", "PATCH", "follow-up", { date: "2031-01-01" }],
      ["contact event", "POST", "contact-events", { kind: "CALL" }],
    ];

    it.each(attempts)(
      "%s: owner ok; other employee 404 and no change; admin 403; anonymous 401",
      async (_n, method, path, body) => {
        const url = (name: string) => `/api/leads/${w.lid[name]}/${path}`;
        expect((await w.call("rohan", method, url("Dev Patel"), body)).statusCode).toBe(200);
        const before = await w.lead("Dev Patel");
        const count0 = await n("Dev Patel");
        const foreign = await w.call("priya", method, url("Dev Patel"), body);
        expect(foreign.statusCode).toBe(404);
        const missing = await w.call(
          "priya",
          method,
          `/api/leads/00000000-0000-4000-8000-000000000000/${path}`,
          body,
        );
        expect(missing.json()).toEqual(foreign.json());
        expect((await w.call("priya", method, url("Imran Ali"), body)).statusCode).toBe(404); // unassigned
        expect((await w.call("admin", method, url("Dev Patel"), body)).statusCode).toBe(403);
        expect((await w.call(null, method, url("Dev Patel"), body)).statusCode).toBe(401);
        expect((await w.call("priya", method, `/api/leads/nope/${path}`, body)).statusCode).toBe(
          422,
        );
        expect(await w.lead("Dev Patel")).toEqual(before);
        expect(await n("Dev Patel")).toBe(count0);
      },
    );

    it("a reassigned lead is immediately off limits to the previous owner", async () => {
      await w.call("admin", "POST", `/api/leads/${w.lid["Dev Patel"]}/assign`, {
        ownerId: w.uid.anita,
      });
      for (const [, method, path, body] of attempts)
        expect(
          (await w.call("rohan", method, `/api/leads/${w.lid["Dev Patel"]}/${path}`, body))
            .statusCode,
        ).toBe(404);
      expect((await post("anita", "Dev Patel", "notes", { text: "mine now" })).statusCode).toBe(
        200,
      );
    });
  });

  it("simultaneous calls and notes all land, in order, without losing the final state", async () => {
    await reset("Aarav Mehta", { status: "NEW", followUpDate: null });
    const before = await n("Aarav Mehta");
    const results = await Promise.all([
      post("priya", "Aarav Mehta", "calls", { outcome: "NO_ANSWER" }),
      post("priya", "Aarav Mehta", "calls", { outcome: "BUSY" }),
      post("priya", "Aarav Mehta", "notes", { text: "a" }),
      post("priya", "Aarav Mehta", "notes", { text: "b" }),
      patch("priya", "Aarav Mehta", "follow-up", { date: "2031-01-01" }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const rows = (await acts("Aarav Mehta")).slice(before);
    // exactly one New → Contacted transition, however the calls interleave
    expect(rows.filter((a) => a.text === "Status: New → Contacted")).toHaveLength(1);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    // the follow-up on the lead equals the last Follow-up entry in history
    const lastFu = [...(await acts("Aarav Mehta"))].reverse().find((a) => a.type === "FOLLOW_UP");
    expect((await w.lead("Aarav Mehta")).followUpDate).toBe(
      (lastFu?.meta as { date: string | null }).date,
    );
    // lastActivityAt is the time of the newest history entry
    expect((await w.lead("Aarav Mehta")).lastActivityAt.getTime()).toBeGreaterThanOrEqual(
      ((await acts("Aarav Mehta")).at(-1) as { createdAt: Date }).createdAt.getTime(),
    );
  });

  describe("customer details", () => {
    const body = {
      address: "12 Park Road",
      flatType: "3 BHK",
      area: "1250 sq ft",
      requirements: "Modular kitchen, extra wardrobe",
    };

    it("the owner saves details; they are stored, shown in the lead and logged in the history", async () => {
      const res = await patch("priya", "Sara Khan", "details", {
        ...body,
        community: "Green Park",
        flatNumber: "B-204",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().changed).toBe(true);
      expect(res.json().lead).toMatchObject({
        ...body,
        community: "Green Park",
        flatNumber: "B-204",
      });
      expect(res.json().timeline[0]).toMatchObject({
        type: "NOTE",
        text: "Details updated: Community, Flat number, Address, Flat type, Area, Requirements",
      });
      // The admin can read them.
      const admin = await w.call("admin", "GET", `/api/leads/${w.lid["Sara Khan"]}`);
      expect(admin.json().lead).toMatchObject(body);
    });

    it("saving the same values again changes nothing and adds no history", async () => {
      const before = await n("Sara Khan");
      const res = await patch("priya", "Sara Khan", "details", body);
      expect(res.json().changed).toBe(false);
      expect(await n("Sara Khan")).toBe(before);
    });

    it("only the changed field is named, and an empty value clears a field", async () => {
      const res = await patch("priya", "Sara Khan", "details", { area: "" });
      expect(res.json().lead.area).toBe("");
      expect(res.json().timeline[0].text).toBe("Details updated: Area");
    });

    it("a lead without a name is shown by its phone, and giving a name replaces it", async () => {
      await reset("Aarav Mehta", { name: "" });
      const before = await w.call("priya", "GET", `/api/leads/${w.lid["Aarav Mehta"]}`);
      expect(before.json().lead.hasName).toBe(false);
      expect(before.json().lead.name).toMatch(/^\+91/);
      const res = await patch("priya", "Aarav Mehta", "details", { name: "Aarav M" });
      expect(res.json().lead).toMatchObject({ name: "Aarav M", hasName: true });
    });

    it("another employee gets 404, an admin 403, anonymous 401, bad input 422", async () => {
      expect((await patch("rohan", "Sara Khan", "details", body)).statusCode).toBe(404);
      expect((await patch("admin", "Sara Khan", "details", body)).statusCode).toBe(403);
      expect((await patch(null, "Sara Khan", "details", body)).statusCode).toBe(401);
      const long = { address: "x".repeat(1001) };
      expect((await patch("priya", "Sara Khan", "details", long)).statusCode).toBe(422);
      expect((await patch("priya", "Sara Khan", "details", { status: "WON" })).statusCode).toBe(
        422,
      );
    });
  });
});
