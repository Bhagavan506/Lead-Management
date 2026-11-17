import { describe, expect, it } from "vitest";
import { buildReminder, oneLine, TEMPLATE_BODY } from "./reminder-message.js";

const T = "2031-01-10";
const due = (name: string, followUpDate = T) => ({ name, followUpDate });

describe("reminder message (fits a WhatsApp template)", () => {
  it("fills the template: first name, count, names", () => {
    const m = buildReminder("Priya Sharma", [due("Aarav Mehta"), due("Sara Khan")], T);
    expect(m.params).toEqual(["Priya", "2 follow-ups", "Aarav Mehta, Sara Khan"]);
    expect(m.text).toBe(
      "Hi Priya, you have 2 follow-ups due today or overdue: Aarav Mehta, Sara Khan. Open Leadbook to update them.",
    );
  });

  it("uses the singular for one", () => {
    expect(buildReminder("Priya", [due("Aarav")], T).params[1]).toBe("1 follow-up");
  });

  it("marks only strictly earlier dates as overdue, not today", () => {
    const m = buildReminder("P", [due("Old", "2031-01-09"), due("Today", T)], T);
    expect(m.params[2]).toBe("Old (overdue), Today");
  });

  it("lists at most five names and counts the rest", () => {
    const m = buildReminder(
      "P",
      Array.from({ length: 8 }, (_, i) => due(`Lead ${i + 1}`)),
      T,
    );
    expect(m.params[1]).toBe("8 follow-ups");
    expect(m.params[2]).toBe("Lead 1, Lead 2, Lead 3, Lead 4, Lead 5 and 3 more");
  });

  it("never contains line breaks, tabs or long runs of spaces, whatever the lead names contain", () => {
    const m = buildReminder(
      "  Pri\nya\tS ",
      [due("Line\nBreak\r\nName"), due("Tab\tName"), due("Many      spaces")],
      T,
    );
    for (const v of [...m.params, m.text]) {
      expect(v).not.toMatch(/[\n\r\t]/);
      expect(v).not.toMatch(/ {2,}/);
    }
    expect(m.params[0]).toBe("Pri");
  });

  it("shortens very long names and never includes phone numbers", () => {
    const m = buildReminder("P", [due("N".repeat(200))], T);
    expect(m.params[2].length).toBeLessThanOrEqual(40);
    expect(m.params[2].endsWith("…")).toBe(true);
    expect(buildReminder("P", [due("Aarav Mehta")], T).text).not.toMatch(/\+?\d{6,}/);
  });

  it("falls back to 'there' when the employee name is blank", () => {
    expect(buildReminder("   ", [due("A")], T).params[0]).toBe("there");
  });

  it("the rendered text is exactly the registered template with the three variables filled in", () => {
    const m = buildReminder("Priya", [due("A")], T);
    expect(
      TEMPLATE_BODY.replace("{{1}}", m.params[0])
        .replace("{{2}}", m.params[1])
        .replace("{{3}}", m.params[2]),
    ).toBe(m.text);
    expect(TEMPLATE_BODY.match(/\{\{\d\}\}/g)).toEqual(["{{1}}", "{{2}}", "{{3}}"]);
  });

  it("oneLine collapses whitespace", () => {
    expect(oneLine("  a \n\n b\t c ")).toBe("a b c");
  });
});
