import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { activities, leads, users } from "../db/schema.js";
import { hasDb } from "../test/db.js";
import { createTestApp, loginCookie, type TestApp } from "../test/app.js";

const csv = (rows: string[], header = "name,company,phone,source") => [header, ...rows].join("\n");

describe.skipIf(!hasDb)("POST /api/leads/upload", () => {
  let ctx: TestApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const e of ["admin", "priya", "rohan", "anita"]) {
      cookies[e] = (await loginCookie(ctx.app, `${e}@demo.com`)).cookie;
      ids[e] = (
        (
          await ctx.t.db
            .select()
            .from(users)
            .where(eq(users.email, `${e}@demo.com`))
        )[0] as { id: string }
      ).id;
    }
  });
  afterAll(() => ctx.close());

  const upload = (body: object, as: string | null = "admin") =>
    ctx.app.inject({
      method: "POST",
      url: "/api/leads/upload",
      headers: as ? { cookie: cookies[as] as string } : {},
      payload: body,
    });
  const totalLeads = async () =>
    ((await ctx.t.db.select({ n: count() }).from(leads))[0] as { n: number }).n;
  const byPhone = async (phone: string) =>
    (await ctx.t.db.select().from(leads).where(eq(leads.phone, phone)))[0];
  const history = async (leadId: string) =>
    (
      await ctx.t.db
        .select()
        .from(activities)
        .where(eq(activities.leadId, leadId))
        .orderBy(activities.createdAt)
    ).map((a) => a.text);

  it("adds valid leads to the pool with E.164 phones and an 'Uploaded by' history entry", async () => {
    const res = await upload({
      csv: csv(["Ravi Kumar,Acme Ltd,98111 22233,Website", "Sita Rao,,+91 98111-22244,"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toEqual({
      rows: 2,
      added: 2,
      skipped: 0,
      skippedInFile: 0,
      skippedExisting: 0,
      invalid: 0,
    });
    const ravi = await byPhone("+919811122233");
    expect(ravi).toMatchObject({
      name: "Ravi Kumar",
      company: "Acme Ltd",
      source: "Website",
      status: "NEW",
      ownerId: null,
    });
    expect((await byPhone("+919811122244"))?.source).toBe("Other");
    expect(await history(ravi?.id as string)).toEqual(["Uploaded by Admin"]);
  });

  it("skips a duplicate inside the file and says which row it duplicates", async () => {
    const res = await upload({
      csv: csv([
        "First,A,9822200001,Web",
        "Second,B,+91 98222-00001,Web",
        "Third,C,09822200001,Web",
      ]),
    });
    const body = res.json();
    expect(body.summary).toMatchObject({
      rows: 3,
      added: 1,
      skipped: 2,
      skippedInFile: 2,
      skippedExisting: 0,
    });
    expect(body.skipped.map((s: { row: number; reason: string }) => [s.row, s.reason])).toEqual([
      [3, "Same phone number as row 2 in this file"],
      [4, "Same phone number as row 2 in this file"],
    ]);
    expect((await byPhone("+919822200001"))?.name).toBe("First"); // first one wins
  });

  it("skips a duplicate against the database and leaves the existing lead untouched", async () => {
    const before = await byPhone("+919810000001"); // Aarav, owned by Priya
    const res = await upload({
      csv: csv(["Impostor,Evil Corp,98100 00001,Web", "Brand New,Fresh Ltd,9833300001,Web"]),
    });
    const body = res.json();
    expect(body.summary).toMatchObject({
      added: 1,
      skipped: 1,
      skippedExisting: 1,
      skippedInFile: 0,
    });
    expect(body.skipped[0]).toMatchObject({
      row: 2,
      phone: "+919810000001",
      reason: "A lead with this phone number already exists",
    });
    expect(await byPhone("+919810000001")).toEqual(before); // name, owner, status unchanged
    expect(await history(before?.id as string)).toHaveLength(5);
  });

  it("reports both kinds of duplicate in one file, in row order", async () => {
    const res = await upload({
      csv: csv(["Dup DB,X,9810000002,Web", "Fresh,Y,9844400001,Web", "Dup File,Z,9844400001,Web"]),
    });
    const body = res.json();
    expect(body.summary).toMatchObject({ rows: 3, added: 1, skippedInFile: 1, skippedExisting: 1 });
    expect(body.skipped.map((s: { row: number }) => s.row)).toEqual([2, 4]);
  });

  it("reports invalid rows with row numbers and reasons, and still adds the good ones", async () => {
    const res = await upload({
      csv: csv([
        "Good,A,9855500001,Web",
        ",B,9855500002,Web",
        "No Phone,C,,Web",
        "Bad Phone,D,123,Web",
        "Also Good,E,9855500003,Web",
      ]),
    });
    const body = res.json();
    expect(body.summary).toMatchObject({ rows: 5, added: 2, invalid: 3 });
    expect(body.invalid.map((r: { row: number; reason: string }) => [r.row, r.reason])).toEqual([
      [3, "Name is missing"],
      [4, "Phone is missing"],
      [5, "Phone number is not valid"],
    ]);
    expect(await byPhone("+919855500002")).toBeUndefined();
  });

  it("rejects whole-file problems with 422 and adds nothing", async () => {
    const before = await totalLeads();
    for (const body of [
      { csv: "name,company\nRavi,Acme" }, // no phone column
      { csv: "name,phone" }, // header only
      { csv: "\n\n" },
      { csv: 'name,phone\n"broken,9811122233' },
      { csv: "" },
      {},
      { csv: 123 },
    ]) {
      const res = await upload(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
    }
    expect((await upload({ csv: "name,company\nRavi,Acme" })).json().error.code).toBe(
      "INVALID_FILE",
    );
    expect(await totalLeads()).toBe(before);
  });

  it("copes with Excel-style files: BOM, CRLF, quotes, semicolons, reordered columns", async () => {
    const res = await upload({
      csv: '﻿Phone;Name;Company\r\n9866600001;"Kumar; Ravi";"Acme ""X"" Ltd"\r\n',
    });
    expect(res.json().summary.added).toBe(1);
    expect(await byPhone("+919866600001")).toMatchObject({
      name: "Kumar; Ravi",
      company: 'Acme "X" Ltd',
    });
  });

  describe("assignment modes", () => {
    const rowsFor = (prefix: string, n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          `${prefix}${i},Co,98${prefix === "S" ? "70" : "71"}00${String(i).padStart(4, "0")},Web`,
      );
    const openLoad = async () =>
      Object.fromEntries(
        await Promise.all(
          ["priya", "rohan", "anita"].map(async (e) => [
            e,
            (
              (
                await ctx.t.db.execute(
                  sql`select count(*)::int as n from leads where owner_id = ${ids[e]} and status not in ('WON','LOST')`,
                )
              ).rows[0] as { n: number }
            ).n,
          ]),
        ),
      ) as Record<string, number>;

    it("'owner' gives every new lead to one employee, with 'Assigned to' after 'Uploaded by'", async () => {
      const res = await upload({ csv: csv(rowsFor("O", 3)), mode: "owner", ownerId: ids.rohan });
      expect(res.json().assignment).toEqual({
        mode: "owner",
        assigned: [{ ownerId: ids.rohan, ownerName: "Rohan Verma", count: 3 }],
      });
      const lead = await byPhone("+919871000000");
      expect(lead?.ownerId).toBe(ids.rohan);
      expect(await history(lead?.id as string)).toEqual([
        "Uploaded by Admin",
        "Assigned to Rohan Verma",
      ]);
      // it is now visible to Rohan and nobody else
      const mine = await ctx.app.inject({
        method: "GET",
        url: `/api/leads/${lead?.id}`,
        headers: { cookie: cookies.rohan as string },
      });
      expect(mine.statusCode).toBe(200);
      const theirs = await ctx.app.inject({
        method: "GET",
        url: `/api/leads/${lead?.id}`,
        headers: { cookie: cookies.priya as string },
      });
      expect(theirs.statusCode).toBe(404);
    });

    it("'split' balances by current load and ends up even", async () => {
      const before = await openLoad();
      const res = await upload({ csv: csv(rowsFor("S", 9)), mode: "split" });
      const after = await openLoad();
      const given = res.json().assignment.assigned as { count: number }[];
      expect(given.reduce((n, a) => n + a.count, 0)).toBe(9);
      const total = Object.values(before).reduce((a, b) => a + b, 0) + 9;
      for (const e of Object.keys(after)) {
        expect(after[e]).toBeGreaterThanOrEqual(Math.floor(total / 3));
        expect(after[e]).toBeLessThanOrEqual(Math.ceil(total / 3));
      }
    });

    it("'none' leaves leads unassigned", async () => {
      await upload({ csv: csv(["Pool One,Co,9880000001,Web"]), mode: "none" });
      expect((await byPhone("+919880000001"))?.ownerId).toBeNull();
    });

    it("never assigns to a deactivated employee, and rejects one by id without adding anything", async () => {
      await ctx.t.db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, ids.anita as string));
      const before = await totalLeads();
      const rejected = await upload({
        csv: csv(["Ghost Owned,Co,9890000001,Web"]),
        mode: "owner",
        ownerId: ids.anita,
      });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.json().error.details[0].path).toBe("ownerId");
      expect(await totalLeads()).toBe(before);

      const ownedByAnita = async () =>
        (
          await ctx.t.db
            .select()
            .from(leads)
            .where(eq(leads.ownerId, ids.anita as string))
        ).length;
      const anitaBefore = await ownedByAnita();
      const rows = Array.from(
        { length: 6 },
        (_, i) => `Skip${i},Co,98910000${String(i).padStart(2, "0")},Web`,
      );
      const split = await upload({ csv: csv(rows), mode: "split" });
      expect(split.json().summary.added).toBe(6);
      const givenTo = split.json().assignment.assigned.map((a: { ownerId: string }) => a.ownerId);
      expect(givenTo).not.toContain(ids.anita);
      expect(await ownedByAnita()).toBe(anitaBefore); // an inactive employee gets nothing
      await ctx.t.db
        .update(users)
        .set({ isActive: true })
        .where(eq(users.id, ids.anita as string));
    });

    it("validates the mode and ownerId combination", async () => {
      const file = csv(["X,Co,9899000001,Web"]);
      for (const body of [
        { csv: file, mode: "owner" },
        { csv: file, mode: "none", ownerId: ids.rohan },
        { csv: file, mode: "owner", ownerId: "not-a-uuid" },
        { csv: file, mode: "nonsense" },
        { csv: file, mode: "owner", ownerId: ids.admin }, // an admin is not an employee
        { csv: file, mode: "owner", ownerId: "00000000-0000-4000-8000-000000000000" },
      ]) {
        expect((await upload(body)).statusCode, JSON.stringify(body)).toBe(422);
      }
      expect(await byPhone("+919899000001")).toBeUndefined();
    });
  });

  it("two simultaneous uploads of the same file add each lead exactly once", async () => {
    const file = csv(
      Array.from({ length: 40 }, (_, i) => `Race${i},Co,98600${String(i).padStart(5, "0")},Web`),
    );
    const [a, b] = await Promise.all([
      upload({ csv: file, mode: "split" }),
      upload({ csv: file, mode: "split" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json().summary.added + b.json().summary.added).toBe(40);
    expect(a.json().summary.skippedExisting + b.json().summary.skippedExisting).toBe(40);
    const rows = await ctx.t.db.execute(
      sql`select count(*)::int as n, count(distinct phone)::int as d from leads where name like 'Race%'`,
    );
    expect(rows.rows[0]).toEqual({ n: 40, d: 40 });
    // each of them has exactly one 'Uploaded by' and one 'Assigned to' (no double history)
    const dupes = await ctx.t.db.execute(sql`
      select lead_id from activities where type in ('UPLOADED','ASSIGNED') and lead_id in (select id from leads where name like 'Race%')
      group by lead_id, type having count(*) > 1`);
    expect(dupes.rows).toHaveLength(0);
  });

  it("handles a large file in one go", async () => {
    const rows = Array.from(
      { length: 1500 },
      (_, i) => `Bulk${i},Co,97${String(i).padStart(8, "0")},Web`,
    );
    const res = await upload({ csv: csv(rows), mode: "split" });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.added).toBe(1500);
  });

  it("is all-or-nothing: a failure part-way leaves nothing behind", async () => {
    await ctx.t.db.execute(sql`
      CREATE FUNCTION boom_upload() RETURNS trigger AS $$
      BEGIN IF NEW.type = 'ASSIGNED' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await ctx.t.db.execute(
      sql`CREATE TRIGGER boom_upload BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION boom_upload()`,
    );
    const leadsBefore = await totalLeads();
    const actsBefore = (
      (await ctx.t.db.select({ n: count() }).from(activities))[0] as { n: number }
    ).n;

    const res = await upload({
      csv: csv(["Atomic One,Co,9812300001,Web", "Atomic Two,Co,9812300002,Web"]),
      mode: "split",
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/simulated/);
    expect(await totalLeads()).toBe(leadsBefore);
    expect(((await ctx.t.db.select({ n: count() }).from(activities))[0] as { n: number }).n).toBe(
      actsBefore,
    );
    await ctx.t.db.execute(sql`DROP TRIGGER boom_upload ON activities`);
  });

  it("is admin-only", async () => {
    const file = csv(["Nope,Co,9877700001,Web"]);
    expect((await upload({ csv: file }, "priya")).statusCode).toBe(403);
    expect((await upload({ csv: file }, null)).statusCode).toBe(401);
    expect(await byPhone("+919877700001")).toBeUndefined();
  });

  it("refuses unauthenticated oversized bodies before reading them, and bodies over the limit", async () => {
    const huge = "x".repeat(7 * 1024 * 1024);
    expect((await upload({ csv: huge }, null)).statusCode).toBe(401);
    expect((await upload({ csv: huge })).statusCode).toBe(413);
  });
});
