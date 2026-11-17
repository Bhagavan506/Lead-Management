import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN, emptyOverview, mockApi, PRIYA, renderApp, signedOut } from "./test/helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const me = (user: unknown) => ({
  "GET /api/auth/me": () => ({ json: { user } }),
  ...emptyOverview,
});

describe("route protection (6.2)", () => {
  it("sends a signed-out visitor to the login page", async () => {
    mockApi({ "GET /api/auth/me": signedOut });
    renderApp("/admin/team");
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends an employee who types an admin URL to their own screen", async () => {
    mockApi(me(PRIYA));
    renderApp("/admin/team");
    expect(await screen.findByText(/You only see leads assigned to you/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Team performance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Upload leads" })).not.toBeInTheDocument();
  });

  it("sends an admin who types an employee URL to the admin overview", async () => {
    mockApi(me(ADMIN));
    renderApp("/app/leads");
    expect(await screen.findByRole("heading", { name: /Team performance/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My leads" })).not.toBeInTheDocument();
  });

  it("shows each role only its own tabs", async () => {
    mockApi(me(ADMIN));
    const { unmount } = renderApp("/admin/overview");
    await screen.findByRole("heading", { name: /Team performance/ });
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Overview",
      "All leads",
      "Upload leads",
      "Team",
      "Reminders",
      "Activity",
    ]);
    unmount();
    mockApi(me(PRIYA));
    renderApp("/app/leads");
    await screen.findByText(/You only see leads assigned to you/);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "My leads",
      "Follow-ups",
    ]);
  });

  it("forces a user with a temporary password to change it before anything else", async () => {
    mockApi(me({ ...PRIYA, mustChangePassword: true }));
    renderApp("/app/leads");
    expect(await screen.findByRole("form", { name: "Change password" })).toBeInTheDocument();
  });

  it("unknown URLs fall back to the user's home", async () => {
    mockApi(me(PRIYA));
    renderApp("/nope/nothing");
    expect(await screen.findByText(/You only see leads assigned to you/)).toBeInTheDocument();
  });

  it("shows a retryable error, not the login page, when the server cannot be reached", async () => {
    mockApi({
      "GET /api/auth/me": () => ({
        status: 503,
        json: { error: { code: "DOWN", message: "Server is down" } },
      }),
    });
    renderApp("/app/leads");
    expect(await screen.findByRole("alert")).toHaveTextContent("Server is down");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("login", () => {
  it("signs an employee in and lands on My leads", async () => {
    const calls = mockApi({
      "GET /api/auth/me": signedOut,
      "POST /api/auth/login": () => ({ json: { user: PRIYA } }),
    });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "  priya@demo.com ");
    await userEvent.type(screen.getByLabelText("Password"), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/You only see leads assigned to you/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/api/auth/login")?.body).toEqual({
      email: "priya@demo.com",
      password: "secret-pass",
    });
  });

  it("returns to the page they were headed for if their role allows it", async () => {
    let signedIn = false;
    mockApi({
      "GET /api/auth/me": () => (signedIn ? { json: { user: ADMIN } } : signedOut()),
      "POST /api/auth/login": () => ((signedIn = true), { json: { user: ADMIN } }),
      "GET /api/activity?page=1&pageSize=40": () => ({
        json: { items: [], page: 1, totalPages: 1, total: 0 },
      }),
    });
    renderApp("/admin/activity");
    await userEvent.type(await screen.findByLabelText("Email"), "admin@demo.com");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("No activity yet.")).toBeInTheDocument();
  });

  it("does not reveal which part was wrong, clears the password, and stays on the form", async () => {
    mockApi({ "GET /api/auth/me": signedOut, "POST /api/auth/login": () => signedOut() });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("a@b.co");
  });

  it("explains a rate limit with the wait time", async () => {
    mockApi({
      "GET /api/auth/me": signedOut,
      "POST /api/auth/login": () => ({
        status: 429,
        json: { error: { code: "TOO_MANY_REQUESTS", message: "Too many" } },
        headers: { "retry-after": "600" },
      }),
    });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 10 min");
  });

  it("sends a temporary-password user to change it, then into the app", async () => {
    let changed = false;
    let signedIn = false;
    mockApi({
      "GET /api/auth/me": () =>
        signedIn ? { json: { user: { ...PRIYA, mustChangePassword: !changed } } } : signedOut(),
      "POST /api/auth/login": () => (
        (signedIn = true),
        { json: { user: { ...PRIYA, mustChangePassword: true } } }
      ),
      "POST /api/auth/change-password": () => ((changed = true), { json: { ok: true } }),
    });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "priya@demo.com");
    await userEvent.type(screen.getByLabelText("Password"), "temp");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.type(await screen.findByLabelText("Current password"), "temp");
    await userEvent.type(screen.getByLabelText(/New password \(/), "brand-new-pass-1");
    await userEvent.type(screen.getByLabelText("New password again"), "brand-new-pass-1");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText(/You only see leads assigned to you/)).toBeInTheDocument();
  });

  it("checks the new password before calling the API", async () => {
    const calls = mockApi({
      "GET /api/auth/me": () => ({ json: { user: { ...PRIYA, mustChangePassword: true } } }),
    });
    renderApp("/change-password");
    await userEvent.type(await screen.findByLabelText("Current password"), "temp");
    await userEvent.type(screen.getByLabelText(/New password \(/), "short");
    await userEvent.type(screen.getByLabelText("New password again"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 10");
    await userEvent.clear(screen.getByLabelText(/New password \(/));
    await userEvent.type(screen.getByLabelText(/New password \(/), "long-enough-pass");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
    expect(calls.some((c) => c.path === "/api/auth/change-password")).toBe(false);
  });

  it("redirects a signed-in user away from the login page", async () => {
    mockApi(me(ADMIN));
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: /Team performance/ })).toBeInTheDocument();
  });
});

describe("shell (6.3)", () => {
  it("signs out, calls the API, and returns to login", async () => {
    let out = false;
    const calls = mockApi({
      "GET /api/auth/me": () => (out ? signedOut() : { json: { user: PRIYA } }),
      "POST /api/auth/logout": () => ((out = true), { json: { ok: true } }),
    });
    renderApp("/app/leads");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/api/auth/logout")).toBe(true);
  });

  it("stays signed in and says so when the logout call fails", async () => {
    mockApi({
      "GET /api/auth/me": () => ({ json: { user: PRIYA } }),
      "POST /api/auth/logout": () => ({
        status: 500,
        json: { error: { code: "X", message: "boom" } },
      }),
    });
    renderApp("/app/leads");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out");
    expect(screen.getByText(/You only see leads assigned to you/)).toBeInTheDocument();
  });

  it("cycles Auto → Light → Dark → Auto, applies it to the page and remembers it", async () => {
    mockApi(me(PRIYA));
    renderApp("/app/leads");
    const btn = await screen.findByRole("button", { name: /Theme: Auto/ });
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("lb.theme")).toBe("light");
    await userEvent.click(screen.getByRole("button", { name: /Theme: Light/ }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: /Theme: Dark/ }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("lb.theme")).toBeNull();
  });

  it("starts in the saved theme", async () => {
    localStorage.setItem("lb.theme", "dark");
    mockApi(me(PRIYA));
    renderApp("/app/leads");
    expect(await screen.findByRole("button", { name: /Theme: Dark/ })).toBeInTheDocument();
  });
});
