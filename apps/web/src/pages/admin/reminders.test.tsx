import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN, mockApi, PRIYA, renderApp } from "../../test/helpers";

afterEach(() => vi.unstubAllGlobals());

const admin = { "GET /api/auth/me": () => ({ json: { user: ADMIN } }) };
const settings = (o = {}) => ({
  json: { staleDays: 2, reminderEnabled: true, reminderTime: "09:00", ...o },
});
const due = (employees: unknown[] = [], provider = "mock") => ({
  json: { today: "2031-01-10", provider, employees },
});
const emp = (o = {}) => ({
  employeeId: "E1",
  name: "Priya Sharma",
  phone: "+919820000001",
  leads: [
    { id: "L1", name: "Aarav Mehta", followUpDate: "2031-01-09", overdue: true },
    { id: "L2", name: "Sara Khan", followUpDate: "2031-01-10", overdue: false },
  ],
  message:
    "Hi Priya, you have 2 follow-ups due today or overdue: Aarav Mehta (overdue), Sara Khan. Open Leadbook to update them.",
  ...o,
});
const logPath = "GET /api/reminders/log?page=1&pageSize=20";

describe("Admin Reminders (9.3)", () => {
  it("shows the settings, who is due with the exact message, and says plainly that mock mode sends nothing", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([emp()]),
    });
    renderApp("/admin/reminders");
    expect(await screen.findByLabelText("Send reminders to employees")).toBeChecked();
    expect(screen.getByLabelText("Reminder time")).toHaveValue("09:00");
    expect(screen.getByText(/nothing is actually sent to WhatsApp/)).toBeInTheDocument();
    const bubble = await screen.findByLabelText("Message for Priya Sharma");
    expect(bubble).toHaveTextContent(
      "Hi Priya, you have 2 follow-ups due today or overdue: Aarav Mehta (overdue), Sara Khan.",
    );
    expect(screen.getByText("(overdue)", { selector: "span span" })).toBeInTheDocument();
  });

  it("does not claim test mode when a real provider is in use", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([], "meta"),
    });
    renderApp("/admin/reminders");
    expect(await screen.findByText(/Sending through meta/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing is actually sent/)).not.toBeInTheDocument();
  });

  it("turning reminders on and changing the time save immediately", async () => {
    const calls = mockApi({
      ...admin,
      "GET /api/settings": () => settings({ reminderEnabled: false }),
      "PUT /api/settings": ({ body }) => settings(body as object),
    });
    renderApp("/admin/reminders");
    await userEvent.click(await screen.findByLabelText("Send reminders to employees"));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ reminderEnabled: true }),
    );
    const time = screen.getByLabelText("Reminder time");
    await userEvent.clear(time);
    await userEvent.type(time, "10:15");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1); // typing alone saved nothing more
    await userEvent.tab();
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({
        reminderTime: "10:15",
      }),
    );
  });

  it("'Send all due now' is disabled when reminders are off or nobody is due", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings({ reminderEnabled: false }),
      "GET /api/reminders/due": () => due([emp()]),
    });
    const { unmount } = renderApp("/admin/reminders");
    expect(await screen.findByRole("button", { name: "Send all due now" })).toBeDisabled();
    unmount();
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([]),
    });
    renderApp("/admin/reminders");
    expect(await screen.findByRole("button", { name: "Send all due now" })).toBeDisabled();
    expect(screen.getByText("Nobody has a follow-up due today or overdue.")).toBeInTheDocument();
  });

  it("sends now and reports sent, failed, skipped and no-number outcomes", async () => {
    const calls = mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([emp()]),
      "POST /api/reminders/send-now": () => ({
        json: { sent: 2, failed: 1, alreadySent: 1, noPhone: ["Rohan Verma"] },
      }),
    });
    renderApp("/admin/reminders");
    await userEvent.click(await screen.findByRole("button", { name: "Send all due now" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sent 2 reminders.");
    expect(status).toHaveTextContent("1 failed.");
    expect(status).toHaveTextContent("1 skipped");
    expect(status).toHaveTextContent("No WhatsApp number for Rohan Verma.");
    expect(calls.filter((c) => c.path === "/api/reminders/send-now")).toHaveLength(1);
  });

  it("warns about an employee with due follow-ups but no number", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([emp({ phone: null })]),
    });
    renderApp("/admin/reminders");
    expect(
      await screen.findByText(/No WhatsApp number, so nothing can be sent/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send all due now" })).toBeDisabled(); // the only one due cannot be reached
  });

  it("shows the API's message when sending is refused", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([emp()]),
      "POST /api/reminders/send-now": () => ({
        status: 409,
        json: {
          error: { code: "REMINDERS_DISABLED", message: "Turn reminders on before sending" },
        },
      }),
    });
    renderApp("/admin/reminders");
    await userEvent.click(await screen.findByRole("button", { name: "Send all due now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Turn reminders on before sending");
  });

  it("lists sent reminders with type and status, failed ones marked", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      [logPath]: () => ({
        json: {
          items: [
            {
              id: "1",
              employeeName: "Priya Sharma",
              date: "2031-01-10",
              kind: "SCHEDULED",
              status: "SENT",
              messageText: "Hi Priya, daily",
              provider: "mock",
              createdAt: new Date().toISOString(),
            },
            {
              id: "2",
              employeeName: "Rohan Verma",
              date: "2031-01-10",
              kind: "MANUAL",
              status: "FAILED",
              messageText: "Hi Rohan, manual",
              provider: "mock",
              createdAt: new Date().toISOString(),
            },
          ],
          page: 1,
          totalPages: 1,
          total: 2,
        },
      }),
    });
    renderApp("/admin/reminders");
    const row = (await screen.findByText("Hi Rohan, manual")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Send now")).toBeInTheDocument();
    expect(within(row).getByText("Failed")).toHaveClass("text-bad");
    const daily = screen.getByText("Hi Priya, daily").closest("tr") as HTMLElement;
    expect(within(daily).getByText("Daily")).toBeInTheDocument();
    expect(within(daily).getByText("Sent")).toBeInTheDocument();
  });
});

describe("Employee reminder panel (8.3 / 9.3)", () => {
  const me = { "GET /api/auth/me": () => ({ json: { user: PRIYA } }) };

  it("says when reminders are off", async () => {
    mockApi({ ...me });
    renderApp("/app/follow-ups");
    expect(
      await screen.findByText("Off. Your admin has not enabled reminders."),
    ).toBeInTheDocument();
    expect(screen.getByText("No reminders received yet.")).toBeInTheDocument();
  });

  it("shows when and where it will arrive, and the last messages received", async () => {
    mockApi({
      ...me,
      "GET /api/reminders/mine": () => ({
        json: {
          enabled: true,
          time: "09:00",
          phone: "+919820000001",
          recent: [
            {
              id: "m1",
              messageText:
                "Hi Priya, you have 1 follow-up due today or overdue: Aarav Mehta. Open Leadbook to update them.",
              status: "SENT",
              createdAt: new Date().toISOString(),
            },
            {
              id: "m2",
              messageText: "Older one",
              status: "FAILED",
              createdAt: new Date(Date.now() - 86_400_000).toISOString(),
            },
          ],
        },
      }),
    });
    renderApp("/app/follow-ups");
    expect(
      await screen.findByText(
        "On. You get a message at 09:00 on +919820000001 when follow-ups are due.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hi Priya, you have 1 follow-up/)).toBeInTheDocument();
    expect(screen.getByText(/could not be delivered/)).toBeInTheDocument();
  });

  it("tells an employee without a number why nothing arrives", async () => {
    mockApi({
      ...me,
      "GET /api/reminders/mine": () => ({
        json: { enabled: true, time: "09:00", phone: null, recent: [] },
      }),
    });
    renderApp("/app/follow-ups");
    expect(await screen.findByText(/no WhatsApp number on your account/)).toBeInTheDocument();
  });
});

describe("Push notifications", () => {
  const me = { "GET /api/auth/me": () => ({ json: { user: PRIYA } }) };
  const mine = (o = {}) => ({
    "GET /api/reminders/mine": () => ({
      json: {
        enabled: true,
        time: "09:00",
        phone: null,
        channel: "push",
        pushAvailable: true,
        devices: 0,
        recent: [],
        ...o,
      },
    }),
  });
  const fakeSub = {
    endpoint: "https://push.example.com/abc",
    toJSON: () => ({ endpoint: "https://push.example.com/abc", keys: { p256dh: "k", auth: "a" } }),
    unsubscribe: async () => true,
  };

  afterEach(() => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  function stubBrowser(permission: NotificationPermission = "default") {
    let sub: typeof fakeSub | null = null;
    const pushManager = {
      getSubscription: async () => sub,
      subscribe: async () => (sub = fakeSub),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => ({}),
        ready: Promise.resolve({ pushManager }),
        getRegistration: async () => ({ pushManager }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission, requestPermission: async () => "granted" });
  }

  it("tells an employee on a browser without push support what to do", async () => {
    mockApi({ ...me, ...mine() });
    renderApp("/app/follow-ups");
    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(await screen.findByText(/add Leadbook to your Home Screen/)).toBeInTheDocument();
  });

  it("turns notifications on for this device and registers it with the server", async () => {
    stubBrowser();
    const calls = mockApi({
      ...me,
      ...mine(),
      "GET /api/push/public-key": () => ({ json: { publicKey: "BPublicKey_-" } }),
      "POST /api/push/subscribe": () => ({ json: { devices: 1 } }),
    });
    renderApp("/app/follow-ups");
    await userEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    expect(await screen.findByText("Notifications are on for this device.")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/api/push/subscribe")?.body).toEqual(fakeSub.toJSON());
    expect(await screen.findByRole("button", { name: "Send me a test" })).toBeInTheDocument();
  });

  it("explains when the browser has blocked notifications", async () => {
    stubBrowser("denied");
    mockApi({ ...me, ...mine() });
    renderApp("/app/follow-ups");
    expect(await screen.findByText(/blocked for this site/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on notifications" })).toBeDisabled();
  });

  it("the admin sees who has no device, and cannot send when nobody can be reached", async () => {
    mockApi({
      ...admin,
      "GET /api/settings": () => settings(),
      "GET /api/reminders/due": () => due([emp({ phone: null, reachable: false })], "push"),
      [logPath]: () => ({ json: { items: [], page: 1, totalPages: 1, total: 0 } }),
    });
    renderApp("/admin/reminders");
    expect(
      await screen.findByRole("heading", { name: "Follow-up notifications" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/No device with notifications on, so nothing can be sent/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send all due now" })).toBeDisabled();
  });
});
