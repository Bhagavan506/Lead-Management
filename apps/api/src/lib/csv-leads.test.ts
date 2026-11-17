import { describe, expect, it } from "vitest";
import { CsvFileError, MAX_UPLOAD_ROWS, parseLeadCsv } from "./csv-leads.js";

const parse = (s: string) => parseLeadCsv(s, "IN");

describe("parseLeadCsv", () => {
  it("parses a simple file and normalizes phones", () => {
    const r = parse("name,company,phone,source\nRavi Kumar,Acme Ltd,98111 22233,Website\n");
    expect(r.valid).toEqual([
      {
        row: 2,
        name: "Ravi Kumar",
        company: "Acme Ltd",
        phone: "+919811122233",
        source: "Website",
      },
    ]);
    expect(r.invalid).toEqual([]);
  });

  it("accepts any column order and case, ignores extra columns, defaults optional ones", () => {
    const r = parse("PHONE,Notes,Name\n9811122233,hello,Ravi\n");
    expect(r.valid[0]).toMatchObject({
      name: "Ravi",
      company: "",
      source: "Other",
      phone: "+919811122233",
    });
  });

  it("handles quoted commas and quotes, CRLF, BOM, and a trailing blank line", () => {
    const r = parse('﻿name,company,phone\r\n"Kumar, Ravi","Acme ""Best"" Ltd",9811122233\r\n\r\n');
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]).toMatchObject({ name: "Kumar, Ravi", company: 'Acme "Best" Ltd' });
  });

  it("accepts semicolon and tab separated files", () => {
    expect(parse("name;phone\nRavi;9811122233").valid).toHaveLength(1);
    expect(parse("name\tphone\nRavi\t9811122233").valid).toHaveLength(1);
  });

  it("reports invalid rows with their file row number and a reason, and keeps the good ones", () => {
    const r = parse(
      "name,phone\nGood,9811122233\n,9811122244\nNo Phone,\nBad Phone,12\nAlso Good,9811122255",
    );
    expect(r.valid.map((v) => v.row)).toEqual([2, 6]);
    expect(r.invalid).toEqual([
      { row: 3, name: "", phone: "9811122244", reason: "Name is missing" },
      { row: 4, name: "No Phone", phone: "", reason: "Phone is missing" },
      { row: 5, name: "Bad Phone", phone: "12", reason: "Phone number is not valid" },
    ]);
  });

  it("flags a duplicate inside the file whatever the phone spelling, and keeps the first", () => {
    const r = parse(
      "name,phone\nFirst,9811122233\nSecond,+91 98111-22233\nThird,09811122233\nOther,9811122244",
    );
    expect(r.valid.map((v) => v.name)).toEqual(["First", "Other"]);
    expect(r.duplicatesInFile.map((d) => [d.row, d.reason])).toEqual([
      [3, "Same phone number as row 2 in this file"],
      [4, "Same phone number as row 2 in this file"],
    ]);
  });

  it("rejects a file without the required columns", () => {
    expect(() => parse("name,company\nRavi,Acme")).toThrow(/must include: phone/);
    expect(() => parse("phone\n9811122233")).toThrow(/must include: name/);
    expect(() => parse("foo,bar\n1,2")).toThrow(/name, phone/);
  });

  it("rejects an empty file, a header-only file and a file that is too long", () => {
    expect(() => parse("")).toThrow(CsvFileError);
    expect(() => parse("\n\n")).toThrow(/empty/);
    expect(() => parse("name,phone")).toThrow(/no leads/);
    const big =
      "name,phone\n" +
      Array.from(
        { length: MAX_UPLOAD_ROWS + 1 },
        (_, i) => `N${i},98${String(i).padStart(8, "0")}`,
      ).join("\n");
    expect(() => parse(big)).toThrow(/Too many rows/);
  });

  it("rejects malformed quoting as a file error", () => {
    expect(() => parse('name,phone\n"Ravi,9811122233')).toThrow(CsvFileError);
  });

  it("rejects over-long fields", () => {
    expect(parse(`name,phone\n${"x".repeat(201)},9811122233`).invalid[0]?.reason).toMatch(
      /Name is longer/,
    );
    expect(parse(`name,phone,company\nA,9811122233,${"x".repeat(201)}`).invalid[0]?.reason).toMatch(
      /Company is longer/,
    );
  });

  it("respects the default country", () => {
    expect(parseLeadCsv("name,phone\nA,415 555 2671", "US").valid[0]?.phone).toBe("+14155552671");
    expect(parseLeadCsv("name,phone\nA,9810000001", "IN").valid[0]?.phone).toBe("+919810000001");
    expect(parseLeadCsv("name,phone\nA,9810000001", "US").invalid).toHaveLength(1);
  });
});
