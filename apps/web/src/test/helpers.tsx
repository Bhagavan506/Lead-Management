import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { App } from "../App";
import { AuthProvider, type User } from "../lib/auth";

export const ADMIN: User = {
  id: "a1",
  name: "Admin",
  email: "admin@demo.com",
  role: "ADMIN",
  phone: null,
  mustChangePassword: false,
};
export const PRIYA: User = {
  id: "e1",
  name: "Priya Sharma",
  email: "priya@demo.com",
  role: "EMPLOYEE",
  phone: "+919800000001",
  mustChangePassword: false,
};

type Handler = (req: {
  method: string;
  body: unknown;
}) => { status?: number; json?: unknown; headers?: Record<string, string> } | undefined;

/** Replaces fetch with routes keyed "METHOD /path". Unmatched calls fail the test loudly. */
export function mockApi(given: Record<string, Handler>) {
  // Quiet empty answers for the list screens, so a test only spells out what it cares about.
  const routes = { ...defaults(), ...given };
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const h = routes[`${method} ${path}`];
    if (!h) throw new Error(`Unmocked request: ${method} ${path}`);
    const r = h({ method, body }) ?? {};
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: r.headers,
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export const signedOut = () => ({
  status: 401,
  json: { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
});

export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Empty-but-valid answers for everything the admin Overview loads. */
export const emptyOverview = {
  "GET /api/stats/overview": () => ({
    json: { total: 0, unassigned: 0, open: 0, won: 0, lost: 0, overdue: 0, stale: 0, staleDays: 2 },
  }),
  "GET /api/stats/team": () => ({ json: { employees: [] } }),
  "GET /api/stats/stale": () => ({ json: { staleDays: 2, total: 0, leads: [] } }),
  "GET /api/stats/lost-reasons": () => ({ json: { total: 0, reasons: [] } }),
};

export const emptySummary = {
  total: 0,
  notContacted: 0,
  followUpsDue: 0,
  won: 0,
  today: "2031-01-10",
};
export const emptyEmployeeData = {
  "GET /api/leads/summary": () => ({ json: emptySummary }),
  "GET /api/leads?page=1&pageSize=50": () => ({
    json: { leads: [], page: 1, pageSize: 50, total: 0, totalPages: 1, staleDays: 2 },
  }),
  "GET /api/leads?followUp=scheduled&page=1&pageSize=100": () => ({
    json: { leads: [], page: 1, pageSize: 100, total: 0, totalPages: 1, staleDays: 2 },
  }),
};

function defaults(): Record<string, Handler> {
  return { ...emptyOverview, ...emptyEmployeeData };
}
