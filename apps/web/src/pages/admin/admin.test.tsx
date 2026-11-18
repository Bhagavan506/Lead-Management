import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDesktop } from "../../test/setup";
import { ADMIN, emptyOverview, mockApi, renderApp } from "../../test/helpers";

afterEach(() => vi.unstubAllGlobals());

const me = { "GET /api/auth/me": () => ({ json: { user: ADMIN } }) };
const lead = (o: Record<string, unknown> = {}) => ({
  id: "L1",
  name: "Aarav Mehta",
  hasName: true,
  company: "Acme",
  phone: "+919810000001",
  source: "Web",
  community: "",
  flatNumber: "",
  address: "",
  flatType: "",
  area: "",
  requirements: "",
  status: "QUALIFIED",
  lostReason: null,
  followUpDate: null,
  ownerId: "E1",
  ownerName: "Priya Sharma",
  lastActivityAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  lastActivityText: "Note: hello",
  isStale: false,
  createdAt: new Date().toISOString(),
  ...o,
});
const list = (leads: unknown[], extra = {}) => ({
  json: {
    leads,
    page: 1,
    pageSize: 25,
    total: leads.length,
    totalPages: 1,
    staleDays: 2,
    ...extra,
  },
});
const users = {
  "GET /api/users": () => ({
    json: {
      users: [
        {
          id: "A1",
          name: "Admin",
          email: "admin@demo.com",
          role: "ADMIN",
          phone: null,
          isActive: true,
          openLeads: 0,
        },
        {
          id: "E1",
          name: "Priya Sharma",
          email: "priya@demo.com",
          role: "EMPLOYEE",
          phone: "+919800000001",
          isActive: true,
          openLeads: 3,
        },
        {
          id: "E2",
          name: "Rohan Verma",
          email: "rohan@demo.com",
          role: "EMPLOYEE",
          phone: "+919800000002",
          isActive: true,
          openLeads: 0,
        },
        {
          id: "E3",
          name: "Old Timer",
          email: "old@demo.com",
          role: "EMPLOYEE",
          phone: "+919800000003",
          isActive: false,
          openLeads: 0,
        },
      ],
    },
  }),
};

describe("Overview (7.1)", () => {
  it("shows the stats, team table, stale list and lost reasons from the API", async () => {
    mockApi({
      ...me,
      "GET /api/stats/overview": () => ({
        json: {
          total: 9,
          unassigned: 2,
          open: 6,
          won: 1,
          lost: 2,
          overdue: 3,
          stale: 1,
          staleDays: 2,
        },
      }),
      "GET /api/stats/team": () => ({
        json: {
          employees: [
            {
              employeeId: "E1",
              name: "Priya Sharma",
              assigned: 4,
              notContacted: 1,
              worked: 3,
              won: 1,
              lost: 0,
              overdue: 2,
              lastActivityAt: null,
            },
          ],
        },
      }),
      "GET /api/stats/stale": () => ({
        json: {
          staleDays: 2,
          total: 1,
          leads: [
            {
              id: "L9",
              name: "Meera Iyer",
              ownerName: "Rohan Verma",
              status: "CONTACTED",
              lastActivityAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
            },
          ],
        },
      }),
      "GET /api/stats/lost-reasons": () => ({
        json: { total: 2, reasons: [{ reason: "PRICE", label: "Price", count: 2 }] },
      }),
    });
    renderApp("/admin/overview");
    expect(await screen.findByText("Total leads")).toBeInTheDocument();
    const panel = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    expect(within(panel("Total leads")).getByText("9")).toBeInTheDocument();
    expect(within(panel("Unassigned")).getByText("2")).toBeInTheDocument();
    expect(within(panel("Overdue follow-ups")).getByText("3")).toBeInTheDocument();
    const row = (await screen.findByRole("link", { name: "Priya Sharma" })).closest(
      "tr",
    ) as HTMLElement;
    expect(
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Priya Sharma", "4", "1", "3", "1", "0", "2", "No activity"]);
    expect(screen.getByRole("link", { name: "Priya Sharma" })).toHaveAttribute(
      "href",
      "/admin/leads?owner=E1",
    );
    expect(screen.getByRole("button", { name: "Meera Iyer" })).toBeInTheDocument();
    expect(screen.getByText("5 d ago")).toBeInTheDocument();
    expect(screen.getByText(/Price:/)).toBeInTheDocument();
  });

  it("shows friendly empty states", async () => {
    mockApi({ ...me, ...emptyOverview });
    renderApp("/admin/overview");
    expect(await screen.findByText(/No active employees yet/)).toBeInTheDocument();
    expect(screen.getByText("No stale leads.")).toBeInTheDocument();
    expect(screen.getByText("No lost leads yet.")).toBeInTheDocument();
  });

  it("shows an error with Try again when a section fails", async () => {
    mockApi({
      ...me,
      ...emptyOverview,
      "GET /api/stats/overview": () => ({
        status: 500,
        json: { error: { code: "X", message: "Server error" } },
      }),
    });
    renderApp("/admin/overview");
    expect(await screen.findByText("Server error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("saves a new stale-days value on blur, and rejects out-of-range values without calling the API", async () => {
    const calls = mockApi({
      ...me,
      ...emptyOverview,
      "PUT /api/settings": () => ({ json: { staleDays: 5 } }),
    });
    renderApp("/admin/overview");
    const input = await screen.findByLabelText("Days");
    await waitFor(() => expect(input).toHaveValue(2));
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("1 to 30");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.clear(input);
    await userEvent.type(input, "5{Enter}");
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ staleDays: 5 }),
    );
  });
});

describe("All leads (7.2) and the read-only drawer (7.3)", () => {
  it("lists leads with the real filters in the request, and the search is debounced", async () => {
    const calls = mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead()]),
      "GET /api/leads?search=aar&page=1&pageSize=25": () => list([lead()]),
    });
    renderApp("/admin/leads");
    expect(await screen.findByRole("button", { name: "Aarav Mehta" })).toBeInTheDocument();
    expect(screen.getByText("1 lead")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search leads"), "aar");
    await waitFor(() => expect(calls.some((c) => c.path.includes("search=aar"))).toBe(true));
    expect(calls.filter((c) => c.path.includes("search=")).map((c) => c.path)).toEqual([
      "/api/leads?search=aar&page=1&pageSize=25",
    ]); // one request, not one per key
  });

  it("applies status, owner, stale and page filters from the URL", async () => {
    const calls = mockApi({
      ...me,
      ...users,
      "GET /api/leads?owner=none&status=NEW&stale=true&page=2&pageSize=25": () =>
        list([lead({ name: "Imran Ali", ownerId: null, ownerName: null })], {
          page: 2,
          totalPages: 3,
          total: 60,
        }),
    });
    renderApp("/admin/leads?owner=none&status=NEW&stale=true&page=2");
    expect(await screen.findByRole("button", { name: "Imran Ali" })).toBeInTheDocument();
    expect(
      calls.some(
        (c) => c.path === "/api/leads?owner=none&status=NEW&stale=true&page=2&pageSize=25",
      ),
    ).toBe(true);
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by status")).toHaveValue("NEW");
    expect(screen.getByLabelText("Filter by owner")).toHaveValue("none");
    expect(screen.getByLabelText("Stale only")).toBeChecked();
  });

  it("says why the list is empty", async () => {
    mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([]),
      "GET /api/leads?status=WON&page=1&pageSize=25": () => list([]),
    });
    const { unmount } = renderApp("/admin/leads");
    expect(await screen.findByText(/No leads yet/)).toBeInTheDocument();
    unmount();
    renderApp("/admin/leads?status=WON");
    expect(await screen.findByText("No leads match these filters.")).toBeInTheDocument();
  });

  it("reassigns with the owner dropdown (and offers only active employees)", async () => {
    const calls = mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead()]),
      "POST /api/leads/L1/assign": () => ({ json: { changed: true } }),
    });
    renderApp("/admin/leads");
    const sel = await screen.findByLabelText("Owner of Aarav Mehta");
    expect(
      within(sel)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Unassigned", "Priya Sharma", "Rohan Verma"]);
    await userEvent.selectOptions(sel, "E2");
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/leads/L1/assign")?.body).toEqual({ ownerId: "E2" }),
    );
  });

  it("moves a lead back to the pool with 'Unassigned'", async () => {
    const calls = mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead()]),
      "POST /api/leads/L1/assign": () => ({ json: { changed: true } }),
    });
    renderApp("/admin/leads");
    await userEvent.selectOptions(await screen.findByLabelText("Owner of Aarav Mehta"), "");
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/leads/L1/assign")?.body).toEqual({ ownerId: null }),
    );
  });

  it("shows the API's message when reassigning fails", async () => {
    mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead()]),
      "POST /api/leads/L1/assign": () => ({
        status: 409,
        json: { error: { code: "OWNER_INACTIVE", message: "That employee is not active" } },
      }),
    });
    renderApp("/admin/leads");
    await userEvent.selectOptions(await screen.findByLabelText("Owner of Aarav Mehta"), "E2");
    expect(await screen.findByRole("alert")).toHaveTextContent("That employee is not active");
  });

  it("uses the compact list on a phone and still reassigns there", async () => {
    setDesktop(false);
    mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead({ isStale: true })]),
    });
    renderApp("/admin/leads");
    expect(await screen.findByRole("button", { name: /Aarav Mehta/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/h ago · Stale/)).toBeInTheDocument();
    expect(screen.getByLabelText("Owner of Aarav Mehta")).toBeInTheDocument();
  });

  it("opens a read-only drawer with the full history, and closes with Escape", async () => {
    mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead({ isStale: true })]),
      "GET /api/leads/L1": () => ({
        json: {
          lead: lead({ isStale: true, followUpDate: "2031-02-03" }),
          timeline: [
            {
              id: "t2",
              type: "NOTE",
              text: "Note: Wants pricing",
              actorId: "E1",
              actorName: "Priya Sharma",
              createdAt: new Date().toISOString(),
            },
            {
              id: "t1",
              type: "UPLOADED",
              text: "Uploaded by Admin",
              actorId: "A1",
              actorName: "Admin",
              createdAt: new Date().toISOString(),
            },
          ],
          timelineTruncated: false,
          staleDays: 2,
        },
      }),
    });
    renderApp("/admin/leads");
    await userEvent.click(await screen.findByRole("button", { name: "Aarav Mehta" }));
    const dlg = await screen.findByRole("dialog", { name: "Lead: Aarav Mehta" });
    expect(within(dlg).getByText("Note: Wants pricing")).toBeInTheDocument();
    expect(within(dlg).getByText("Uploaded by Admin")).toBeInTheDocument();
    expect(within(dlg).getByText("2031-02-03")).toBeInTheDocument();
    expect(within(dlg).getByText("Stale")).toBeInTheDocument();
    // read-only: no way to change anything from the admin drawer
    expect(
      within(dlg).queryByRole("button", { name: /call|note|status|save/i }),
    ).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the customer details the employee collected, read-only", async () => {
    mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([lead()]),
      "GET /api/leads/L1": () => ({
        json: {
          lead: lead({
            community: "Green Park",
            flatNumber: "B-204",
            address: "12 Park Road",
            flatType: "3 BHK",
            area: "1250 sq ft",
            requirements: "Modular kitchen",
          }),
          timeline: [],
          timelineTruncated: false,
          staleDays: 2,
        },
      }),
    });
    renderApp("/admin/leads");
    await userEvent.click(await screen.findByRole("button", { name: "Aarav Mehta" }));
    const dlg = await screen.findByRole("dialog", { name: "Lead: Aarav Mehta" });
    for (const t of [
      "Green Park",
      "B-204",
      "12 Park Road",
      "3 BHK",
      "1250 sq ft",
      "Modular kitchen",
    ])
      expect(within(dlg).getByText(t)).toBeInTheDocument();
    expect(within(dlg).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows 'Lead not found' for a missing lead id in the URL", async () => {
    mockApi({
      ...me,
      ...users,
      "GET /api/leads?page=1&pageSize=25": () => list([]),
      "GET /api/leads/nope": () => ({
        status: 404,
        json: { error: { code: "NOT_FOUND", message: "Lead not found" } },
      }),
    });
    renderApp("/admin/leads?lead=nope");
    expect(await screen.findByText("Lead not found.")).toBeInTheDocument();
  });
});

describe("Upload leads (7.4)", () => {
  const report = {
    summary: { rows: 5, added: 2, skipped: 2, skippedInFile: 1, skippedExisting: 1, invalid: 1 },
    skipped: [{ row: 3, name: "Dup", phone: "+919810000001", reason: "Already exists" }],
    invalid: [{ row: 4, name: "Bad", phone: "123", reason: "Invalid phone number" }],
    reportTruncated: false,
    assignment: {
      mode: "split",
      assigned: [
        { ownerId: "E1", ownerName: "Priya Sharma", count: 1 },
        { ownerId: "E2", ownerName: "Rohan Verma", count: 1 },
      ],
    },
  };

  it("sends pasted rows with the chosen mode and shows a clear result report", async () => {
    const calls = mockApi({ ...me, ...users, "POST /api/leads/upload": () => ({ json: report }) });
    renderApp("/admin/upload");
    await userEvent.click(await screen.findByLabelText(/Split evenly/));
    await userEvent.click(screen.getByLabelText("…or paste rows"));
    await userEvent.paste("name,company,phone,source\nA,B,9810000001,Web");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 added");
    expect(screen.getByRole("status")).toHaveTextContent("1 invalid");
    expect(calls.find((c) => c.path === "/api/leads/upload")?.body).toEqual({
      csv: "name,company,phone,source\nA,B,9810000001,Web",
      mode: "split",
    });
    expect(screen.getByText("Invalid phone number")).toBeInTheDocument();
    expect(screen.getByText("Already exists")).toBeInTheDocument();
    expect(screen.getByText(/Priya Sharma 1, Rohan Verma 1/)).toBeInTheDocument();
  });

  it("asks for content, and for an employee in 'one employee' mode, before calling the API", async () => {
    const calls = mockApi({ ...me, ...users });
    renderApp("/admin/upload");
    await userEvent.click(await screen.findByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a file or paste");
    await userEvent.click(screen.getByLabelText("…or paste rows"));
    await userEvent.paste("name,company,phone,source\nA,B,9810000001,Web");
    await userEvent.click(screen.getByLabelText("One employee"));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose which employee");
    expect(calls.some((c) => c.path === "/api/leads/upload")).toBe(false);
    expect(
      within(screen.getByLabelText("Employee"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Choose an employee", "Priya Sharma", "Rohan Verma"]);
  });

  it("reads a chosen CSV file", async () => {
    const calls = mockApi({ ...me, ...users, "POST /api/leads/upload": () => ({ json: report }) });
    renderApp("/admin/upload");
    const file = new File(["name,company,phone,source\nX,Y,9810000009,Ad"], "leads.csv", {
      type: "text/csv",
    });
    await userEvent.upload(await screen.findByLabelText(/Choose CSV file/), file);
    expect(await screen.findByText("leads.csv")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/leads/upload")?.body).toMatchObject({
        csv: "name,company,phone,source\nX,Y,9810000009,Ad",
        mode: "none",
      }),
    );
  });

  it("shows the API's reason when the whole file is rejected", async () => {
    mockApi({
      ...me,
      ...users,
      "POST /api/leads/upload": () => ({
        status: 422,
        json: { error: { code: "INVALID_FILE", message: "Missing column: phone" } },
      }),
    });
    renderApp("/admin/upload");
    await userEvent.click(await screen.findByLabelText("…or paste rows"));
    await userEvent.paste("name,company\nA,B");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing column: phone");
  });
});

describe("Team (7.5)", () => {
  const withOverview = {
    ...me,
    ...users,
    "GET /api/stats/overview": () => ({ json: { unassigned: 3 } }),
  };

  it("adds an employee and shows the temporary password once", async () => {
    const calls = mockApi({
      ...withOverview,
      "POST /api/users": () => ({
        status: 201,
        json: {
          user: {
            id: "N",
            name: "Zed New",
            email: "zed@demo.com",
            role: "EMPLOYEE",
            phone: "+919800000099",
            isActive: true,
            openLeads: 0,
          },
          temporaryPassword: "Temp-Pass-123",
        },
      }),
    });
    renderApp("/admin/team");
    await userEvent.type(await screen.findByLabelText("Name"), "Zed New");
    await userEvent.type(screen.getByLabelText("Email"), "zed@demo.com");
    await userEvent.type(screen.getByLabelText("WhatsApp number"), "98000 00099");
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(await screen.findByText("Temp-Pass-123")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/api/users" && c.method === "POST")?.body).toEqual({
      name: "Zed New",
      email: "zed@demo.com",
      phone: "98000 00099",
    });
    expect(screen.getByLabelText("Name")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Temp-Pass-123")).not.toBeInTheDocument();
  });

  it("shows the API's message for a duplicate email", async () => {
    mockApi({
      ...withOverview,
      "POST /api/users": () => ({
        status: 409,
        json: { error: { code: "EMAIL_TAKEN", message: "That email is already in use" } },
      }),
    });
    renderApp("/admin/team");
    await userEvent.type(await screen.findByLabelText("Name"), "X");
    await userEvent.type(screen.getByLabelText("Email"), "priya@demo.com");
    await userEvent.type(screen.getByLabelText("WhatsApp number"), "9800000000");
    await userEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already in use");
  });

  it("lists employees only, with status, and confirms before deactivating", async () => {
    const calls = mockApi({
      ...withOverview,
      "POST /api/users/E1/deactivate": () => ({ json: { leadsReturned: 3 } }),
    });
    renderApp("/admin/team");
    expect(await screen.findByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.queryByText("admin@demo.com")).not.toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Priya Sharma" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("3 open leads");
    expect(calls.some((c) => c.path.endsWith("/deactivate"))).toBe(false); // nothing happens until confirmed
    await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.path.endsWith("/deactivate"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Priya Sharma" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }),
    );
    expect(
      await screen.findByText(/3 open leads returned to the unassigned pool/),
    ).toBeInTheDocument();
  });

  it("explains when the last active employee cannot be deactivated", async () => {
    mockApi({
      ...withOverview,
      "POST /api/users/E1/deactivate": () => ({
        status: 409,
        json: {
          error: { code: "LAST_EMPLOYEE", message: "At least one active employee is required" },
        },
      }),
    });
    renderApp("/admin/team");
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate Priya Sharma" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("At least one active employee");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reactivates an inactive employee", async () => {
    const calls = mockApi({
      ...withOverview,
      "POST /api/users/E3/reactivate": () => ({ json: { user: {} } }),
    });
    renderApp("/admin/team");
    await userEvent.click(await screen.findByRole("button", { name: "Reactivate Old Timer" }));
    expect(await screen.findByText("Old Timer reactivated.")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/api/users/E3/reactivate")).toBe(true);
  });

  it("auto-assigns the unassigned pool and reports who got what", async () => {
    mockApi({
      ...withOverview,
      "POST /api/leads/auto-assign": () => ({
        json: { assigned: 3, byEmployee: [{ ownerId: "E2", ownerName: "Rohan Verma", count: 3 }] },
      }),
    });
    renderApp("/admin/team");
    await userEvent.click(
      await screen.findByRole("button", { name: /Auto-assign unassigned leads \(3\)/ }),
    );
    expect(await screen.findByText("Assigned 3 leads: Rohan Verma 3.")).toBeInTheDocument();
  });

  it("hides auto-assign when nothing is unassigned", async () => {
    mockApi({ ...me, ...users, "GET /api/stats/overview": () => ({ json: { unassigned: 0 } }) });
    renderApp("/admin/team");
    await screen.findByText("Priya Sharma");
    expect(screen.queryByRole("button", { name: /Auto-assign/ })).not.toBeInTheDocument();
  });
});

describe("Activity (7.6)", () => {
  const item = (n: number) => ({
    id: `a${n}`,
    text: `Note: n${n}`,
    createdAt: new Date().toISOString(),
    actorName: "Priya Sharma",
    leadId: `L${n}`,
    leadName: `Lead ${n}`,
  });

  it("shows the feed, pages through it, and opens a lead from an entry", async () => {
    mockApi({
      ...me,
      "GET /api/activity?page=1&pageSize=40": () => ({
        json: { items: [item(1), item(2)], page: 1, totalPages: 2, total: 41 },
      }),
      "GET /api/activity?page=2&pageSize=40": () => ({
        json: { items: [item(3)], page: 2, totalPages: 2, total: 41 },
      }),
      "GET /api/leads/L1": () => ({
        json: {
          lead: lead({ id: "L1", name: "Lead 1" }),
          timeline: [],
          timelineTruncated: false,
          staleDays: 2,
        },
      }),
    });
    renderApp("/admin/activity");
    expect(await screen.findByText("Note: n1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newer" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("Note: n3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Older" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Newer" }));
    await userEvent.click((await screen.findByText("Note: n1")).closest("button") as HTMLElement);
    expect(await screen.findByRole("dialog", { name: "Lead: Lead 1" })).toBeInTheDocument();
  });
});
