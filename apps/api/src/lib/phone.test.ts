import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone.js";

const IN = "IN";

describe("normalizePhone", () => {
  it.each([
    ["9810000001", "+919810000001"],
    ["98100 00001", "+919810000001"],
    ["98100-00001", "+919810000001"],
    ["(98100) 00001", "+919810000001"],
    ["  9810000001  ", "+919810000001"],
    ["09810000001", "+919810000001"], // leading national 0
    ["+91 98100 00001", "+919810000001"], // plus prefix
    ["+919810000001", "+919810000001"],
    ["919810000001", "+919810000001"],
    ["0091 98100 00001", "+919810000001"], // international dialling prefix
  ])("normalizes %j to %s", (input, expected) => {
    expect(normalizePhone(input, IN)).toBe(expected);
  });

  it("keeps a number from another country when it has an explicit prefix", () => {
    expect(normalizePhone("+1 415 555 2671", IN)).toBe("+14155552671");
    expect(normalizePhone("+44 7911 123456", IN)).toBe("+447911123456");
  });

  it("uses the configured default country, not a hardcoded one", () => {
    expect(normalizePhone("415 555 2671", "US")).toBe("+14155552671");
    expect(normalizePhone("07911 123456", "GB")).toBe("+447911123456");
    expect(normalizePhone("9810000001", "US")).toBeNull();
  });

  it("produces the same value for every spelling of one number (duplicate detection)", () => {
    const forms = ["9810000001", "+91 98100 00001", "09810000001", "98100-00001"];
    expect(new Set(forms.map((f) => normalizePhone(f, IN))).size).toBe(1);
  });

  it.each([
    [""],
    ["   "],
    ["abc"],
    ["98100"], // too short
    ["12345678901234567890"], // too long
    ["98100x00001"],
    ["+"],
    ["0000000000"],
  ])("rejects invalid input %j", (input) => {
    expect(normalizePhone(input, IN)).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizePhone(undefined, IN)).toBeNull();
    expect(normalizePhone(null, IN)).toBeNull();
    expect(normalizePhone(9810000001, IN)).toBeNull();
  });
});
