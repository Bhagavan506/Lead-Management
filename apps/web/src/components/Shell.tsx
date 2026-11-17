import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { Button } from "./ui";

export interface TabDef {
  to: string;
  label: string;
}

const THEME_LABEL = { system: "Auto", light: "Light", dark: "Dark" } as const;

/** Header, scrollable tab strip and page area shared by the admin and employee areas. */
export function Shell({ tabs }: { tabs: TabDef[] }) {
  const { user, logout } = useAuth();
  const { theme, cycle } = useTheme();
  const nav = useNavigate();
  const [outError, setOutError] = useState(false);
  if (!user) return null;

  return (
    <div className="min-h-screen pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center gap-2 border-b border-ln bg-sf px-4 py-3 sm:px-[18px]">
        <h1 className="text-[19px] font-extrabold tracking-tight">Leadbook</h1>
        <span className="rounded-md bg-ac2 px-2 py-0.5 font-extrabold text-ac">
          {user.role === "ADMIN" ? "Admin" : "Employee"}
        </span>
        <span className="hidden min-w-0 truncate text-mu sm:block">{user.name}</span>
        <span className="flex-1" />
        <Button
          onClick={cycle}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Change theme`}
          title="Change theme"
        >
          {THEME_LABEL[theme]}
        </Button>
        <Button
          className="px-2.5"
          onClick={async () => {
            setOutError(false);
            try {
              await logout();
              nav("/login", { replace: true });
            } catch {
              setOutError(true);
            }
          }}
        >
          Sign out
        </Button>
      </header>
      {outError && (
        <p role="alert" className="bg-sf px-4 py-2 font-bold text-bad">
          Could not sign out. Check your connection and try again.
        </p>
      )}

      <nav
        aria-label="Sections"
        className="scrollbar-none flex gap-0.5 overflow-x-auto border-b border-ln bg-bg px-3 py-1.5 sm:px-[18px]"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }: { isActive: boolean }) =>
              `tap shrink-0 whitespace-nowrap rounded-[7px] px-3 py-1.5 font-bold ${
                isActive ? "bg-sf text-ink ring-1 ring-ln" : "text-mu"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto max-w-[1100px] p-4 sm:p-[18px]">
        <Outlet />
      </main>
    </div>
  );
}

export const ADMIN_TABS: TabDef[] = [
  { to: "/admin/overview", label: "Overview" },
  { to: "/admin/leads", label: "All leads" },
  { to: "/admin/upload", label: "Upload leads" },
  { to: "/admin/team", label: "Team" },
  { to: "/admin/reminders", label: "Reminders" },
  { to: "/admin/activity", label: "Activity" },
];

export const EMPLOYEE_TABS: TabDef[] = [
  { to: "/app/leads", label: "My leads" },
  { to: "/app/follow-ups", label: "Follow-ups" },
];
