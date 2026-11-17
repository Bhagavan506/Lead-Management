/**
 * The reminder text. It is written to fit a WhatsApp message TEMPLATE (the only kind of message a
 * business may start a conversation with): three variables, none with line breaks or tabs, and no
 * customer phone numbers (names only), so the data sent to Meta stays minimal.
 *
 * Register this exact body with Meta (see docs/WHATSAPP.md):
 *   Hi {{1}}, you have {{2}} due today or overdue: {{3}}. Open Leadbook to update them.
 */
export const TEMPLATE_BODY =
  "Hi {{1}}, you have {{2}} due today or overdue: {{3}}. Open Leadbook to update them.";

export interface DueLead {
  name: string;
  followUpDate: string;
}

const MAX_NAMES = 5;
const MAX_NAME_LENGTH = 40;

/** One line, single spaces: Meta rejects newlines, tabs and runs of spaces inside a variable. */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function buildReminder(employeeName: string, due: DueLead[], today: string) {
  const first = oneLine(employeeName).split(" ")[0] || "there";
  const shown = due.slice(0, MAX_NAMES).map((l) => {
    const name = oneLine(l.name);
    const short = name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
    return l.followUpDate < today ? `${short} (overdue)` : short;
  });
  const more = due.length - shown.length;
  const list = more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
  const count = `${due.length} follow-up${due.length === 1 ? "" : "s"}`;
  const params = [first, count, list] as const;
  const text = TEMPLATE_BODY.replace("{{1}}", params[0])
    .replace("{{2}}", params[1])
    .replace("{{3}}", params[2]);
  return { params, text };
}
