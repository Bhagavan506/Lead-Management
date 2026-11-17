import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, PRIYA, renderApp } from "../../test/helpers";

afterEach(() => vi.unstubAllGlobals());

const me = { "GET /api/auth/me": () => ({ json: { user: PRIYA } }) };
const lead = (o: Record<string, unknown> = {}) => ({
  id: "L1",
  name: "Aarav Mehta",
  company: "Northwind",
  phone: "+919810000001",
  source: "Web",
  status: "QUALIFIED",
  lostReason: null,
  followUpDate: null,
  ownerId: "E1",
  ownerName: "Priya Sharma",
  lastActivityAt: new Date().toISOString(),
  lastActivityText: null,
  isStale: false,
  createdAt: new Date().toISOString(),
  ...o,
});
const page = (leads: unknown[]) => ({
  json: { leads, page: 1, pageSize: 50, total: leads.length, totalPages: 1, staleDays: 2 },
});
const summary = (o = {}) => ({
  json: { total: 3, notContacted: 1, followUpsDue: 2, won: 1, today: "2031-01-10", ...o },
});
const detail = (l = lead(), timeline: unknown[] = []) => ({
  json: { lead: l, timeline, timelineTruncated: false, staleDays: 2, changed: true },
});
const entry = (id: string, text: string) => ({
  id,
  type: "NOTE",
  text,
  actorId: "E1",
  actorName: "Priya Sharma",
  createdAt: new Date().toISOString(),
});

describe("My leads (8.1)", () => {
  it("shows my numbers and my lead cards with follow-up, overdue and stale markers", async () => {
    mockApi({
      ...me,
      "GET /api/leads/summary": () => summary(),
      "GET /api/leads?page=1&pageSize=50": () =>
        page([
          lead({ id: "A", name: "Overdue Olly", followUpDate: "2031-01-08", isStale: true }),
          lead({ id: "B", name: "Today Tina", followUpDate: "2031-01-10" }),
          lead({ id: "C", name: "Later Lee", followUpDate: "2031-02-01" }),
          lead({ id: "D", name: "Nodate Nia" }),
          lead({ id: "E", name: "Closed Cal", status: "WON", followUpDate: "2031-01-01" }),
        ]),
    });
    renderApp("/app/leads");
    const tile = (l: string) =>
      (screen.getByText(l, { selector: "small" }).parentElement as HTMLElement).textContent;
    await screen.findByRole("button", { name: "Open Overdue Olly" });
    expect(tile("My leads")).toBe("My leads3");
    expect(tile("Follow-ups due")).toBe("Follow-ups due2");
    expect(tile("Not yet contacted")).toBe("Not yet contacted1");
    const card = (n: string) => screen.getByRole("button", { name: `Open ${n}` });
    expect(card("Overdue Olly")).toHaveTextContent("Follow-up 2031-01-08 (overdue)");
    expect(card("Overdue Olly")).toHaveTextContent("Stale");
    expect(card("Today Tina")).toHaveTextContent("(today)");
    expect(card("Later Lee")).not.toHaveTextContent(/overdue|today/);
    expect(card("Nodate Nia")).toHaveTextContent("No follow-up set");
    expect(card("Closed Cal")).not.toHaveTextContent("overdue"); // closed leads are never overdue
  });

  it("explains an empty list", async () => {
    mockApi({
      ...me,
      "GET /api/leads/summary": () => summary({ total: 0 }),
      "GET /api/leads?page=1&pageSize=50": () => page([]),
    });
    renderApp("/app/leads");
    expect(
      await screen.findByText("Nothing here. Ask your admin to assign leads."),
    ).toBeInTheDocument();
  });

  it("a lead that is not mine shows 'not found' in the drawer, same as a missing one", async () => {
    mockApi({
      ...me,
      "GET /api/leads?page=1&pageSize=50": () => page([]),
      "GET /api/leads/OTHERS": () => ({
        status: 404,
        json: { error: { code: "NOT_FOUND", message: "Lead not found" } },
      }),
    });
    renderApp("/app/leads?lead=OTHERS");
    expect(await screen.findByText("Lead not found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });
});

describe("Follow-ups (8.3)", () => {
  it("asks the API for my scheduled follow-ups only, and shows them", async () => {
    const calls = mockApi({
      ...me,
      "GET /api/leads/summary": () => summary(),
      "GET /api/leads?followUp=scheduled&page=1&pageSize=100": () =>
        page([lead({ name: "Due Dan", followUpDate: "2031-01-09" })]),
    });
    renderApp("/app/follow-ups");
    expect(await screen.findByRole("button", { name: "Open Due Dan" })).toHaveTextContent(
      "(overdue)",
    );
    expect(calls.some((c) => c.path === "/api/leads?followUp=scheduled&page=1&pageSize=100")).toBe(
      true,
    );
  });

  it("has a friendly empty state", async () => {
    mockApi({ ...me });
    renderApp("/app/follow-ups");
    expect(await screen.findByText(/No follow-ups scheduled/)).toBeInTheDocument();
  });
});

describe("Lead drawer for employees (8.2)", () => {
  const open = async (
    handlers: Parameters<typeof mockApi>[0] = {},
    l = lead(),
    timeline: unknown[] = [],
  ) => {
    const calls = mockApi({
      ...me,
      "GET /api/leads/summary": () => summary(),
      "GET /api/leads?page=1&pageSize=50": () => page([l]),
      "GET /api/leads/L1": () => detail(l, timeline),
      ...handlers,
    });
    renderApp("/app/leads");
    await userEvent.click(await screen.findByRole("button", { name: `Open ${l.name}` }));
    const dlg = await screen.findByRole("dialog", { name: `Lead: ${l.name}` });
    return { calls, dlg };
  };
  const sent = (
    calls: { method: string; path: string; body: unknown }[],
    method: string,
    path: string,
  ) => calls.find((c) => c.method === method && c.path === path)?.body;

  it("offers Call and WhatsApp links built from the lead's number, and logs the tap", async () => {
    const { calls, dlg } = await open({ "POST /api/leads/L1/contact-events": () => detail() });
    const call = within(dlg).getByRole("link", { name: "Call" });
    const wa = within(dlg).getByRole("link", { name: "WhatsApp" });
    expect(call).toHaveAttribute("href", "tel:+919810000001");
    expect(wa.getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/919810000001\?text=Hi%20Aarav%2C%20this%20is%20Priya%20Sharma/,
    );
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa).toHaveAttribute("rel", expect.stringContaining("noopener"));
    wa.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    call.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(call);
    await userEvent.click(wa);
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === "/api/leads/L1/contact-events").map((c) => c.body),
      ).toEqual([{ kind: "CALL" }, { kind: "WHATSAPP" }]),
    );
  });

  it("changes status directly for ordinary statuses and shows the new history", async () => {
    const { calls, dlg } = await open({
      "PATCH /api/leads/L1/status": () =>
        detail(lead({ status: "PROPOSAL" }), [entry("t1", "Status: Qualified → Proposal")]),
    });
    await userEvent.selectOptions(within(dlg).getByLabelText("Status"), "PROPOSAL");
    expect(await within(dlg).findByText("Status: Qualified → Proposal")).toBeInTheDocument();
    expect(sent(calls, "PATCH", "/api/leads/L1/status")).toEqual({ status: "PROPOSAL" });
    expect(within(dlg).getByLabelText("Status")).toHaveValue("PROPOSAL");
  });

  it("asks for a reason before marking Lost, and sends nothing until one is chosen", async () => {
    const { calls, dlg } = await open({
      "PATCH /api/leads/L1/status": () =>
        detail(lead({ status: "LOST", lostReason: "PRICE" }), [
          entry("t1", "Status: Qualified → Lost (Price)"),
        ]),
    });
    await userEvent.selectOptions(within(dlg).getByLabelText("Status"), "LOST");
    const group = within(dlg).getByRole("group", { name: "Lost reason" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Price",
      "No response",
      "Chose competitor",
      "Wrong contact",
      "Not interested",
      "Other",
    ]);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(within(dlg).getByLabelText("Status")).toHaveValue("QUALIFIED"); // still the real status
    await userEvent.click(within(group).getByRole("button", { name: "Price" }));
    expect(await within(dlg).findByText("Status: Qualified → Lost (Price)")).toBeInTheDocument();
    expect(sent(calls, "PATCH", "/api/leads/L1/status")).toEqual({
      status: "LOST",
      lostReason: "PRICE",
    });
    expect(within(dlg).queryByRole("group", { name: "Lost reason" })).not.toBeInTheDocument();
    expect(within(dlg).getByText("Price")).toBeInTheDocument(); // reason tag
  });

  it("Cancel on the lost-reason box changes nothing", async () => {
    const { calls, dlg } = await open();
    await userEvent.selectOptions(within(dlg).getByLabelText("Status"), "LOST");
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(within(dlg).queryByRole("group", { name: "Lost reason" })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("logs each call outcome with the right code", async () => {
    const { calls, dlg } = await open({
      "POST /api/leads/L1/calls": () => detail(lead(), [entry("t1", "Call: Busy")]),
    });
    for (const [label, code] of [
      ["Answered", "ANSWERED"],
      ["No answer", "NO_ANSWER"],
      ["Busy", "BUSY"],
      ["Wrong number", "WRONG_NUMBER"],
    ]) {
      await userEvent.click(within(dlg).getByRole("button", { name: label as string }));
      await waitFor(() =>
        expect(calls.filter((c) => c.path === "/api/leads/L1/calls").at(-1)?.body).toEqual({
          outcome: code,
        }),
      );
    }
    expect(await within(dlg).findByText("Call: Busy")).toBeInTheDocument();
  });

  it("shows the follow-up the server set after 'No answer' (tomorrow)", async () => {
    const { dlg } = await open({
      "POST /api/leads/L1/calls": () =>
        detail(lead({ followUpDate: "2031-01-11" }), [entry("t2", "Follow-up set to 2031-01-11")]),
    });
    await userEvent.click(within(dlg).getByRole("button", { name: "No answer" }));
    await waitFor(() =>
      expect(within(dlg).getByLabelText("Next follow-up")).toHaveValue("2031-01-11"),
    );
  });

  it("sets and clears the follow-up date", async () => {
    let date: string | null = null;
    const { calls, dlg } = await open({
      "PATCH /api/leads/L1/follow-up": ({ body }) => (
        (date = (body as { date: string | null }).date),
        detail(lead({ followUpDate: date }))
      ),
    });
    const input = within(dlg).getByLabelText("Next follow-up");
    await userEvent.type(input, "2031-03-04");
    await waitFor(() =>
      expect(sent(calls, "PATCH", "/api/leads/L1/follow-up")).toEqual({ date: "2031-03-04" }),
    );
    await userEvent.clear(within(dlg).getByLabelText("Next follow-up"));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ date: null }),
    );
  });

  it("disables the follow-up date on a closed lead and says why", async () => {
    const { dlg } = await open({}, lead({ status: "WON" }));
    expect(within(dlg).getByLabelText("Next follow-up")).toBeDisabled();
    expect(within(dlg).getByText(/Reopen the lead to set one/)).toBeInTheDocument();
  });

  it("adds a note, clears the box, and shows it in the history", async () => {
    const { calls, dlg } = await open({
      "POST /api/leads/L1/notes": () => detail(lead(), [entry("t1", "Note: Wants a demo")]),
    });
    const add = within(dlg).getByRole("button", { name: "Add note" });
    expect(add).toBeDisabled(); // nothing typed
    await userEvent.type(within(dlg).getByLabelText("Note"), "  Wants a demo ");
    await userEvent.click(add);
    expect(await within(dlg).findByText("Note: Wants a demo")).toBeInTheDocument();
    expect(sent(calls, "POST", "/api/leads/L1/notes")).toEqual({ text: "Wants a demo" });
    expect(within(dlg).getByLabelText("Note")).toHaveValue("");
  });

  it("Enter in the note box adds the note", async () => {
    const { calls, dlg } = await open({ "POST /api/leads/L1/notes": () => detail() });
    await userEvent.type(within(dlg).getByLabelText("Note"), "quick{Enter}");
    await waitFor(() =>
      expect(sent(calls, "POST", "/api/leads/L1/notes")).toEqual({ text: "quick" }),
    );
  });

  it("shows the API's message when an action fails, and keeps what the person typed", async () => {
    const { dlg } = await open({
      "POST /api/leads/L1/notes": () => ({
        status: 404,
        json: { error: { code: "NOT_FOUND", message: "Lead not found" } },
      }),
    });
    await userEvent.type(within(dlg).getByLabelText("Note"), "keep me");
    await userEvent.click(within(dlg).getByRole("button", { name: "Add note" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("Lead not found");
    expect(within(dlg).getByLabelText("Note")).toHaveValue("keep me");
  });

  it("refreshes the card list and my numbers after an action", async () => {
    const { calls, dlg } = await open({ "POST /api/leads/L1/calls": () => detail() });
    const before = calls.filter((c) => c.path === "/api/leads/summary").length;
    await userEvent.click(within(dlg).getByRole("button", { name: "Answered" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === "/api/leads/summary").length).toBeGreaterThan(before),
    );
  });
});
