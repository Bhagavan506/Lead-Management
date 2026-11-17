import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui";
import { RedirectHome, RequireRole } from "./components/Guards";
import { ADMIN_TABS, EMPLOYEE_TABS, Shell } from "./components/Shell";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { LoginPage } from "./pages/Login";

// Each area's screens load on first visit, so the sign-in page and the other role's code are not downloaded.
const ActivityPage = lazy(() =>
  import("./pages/admin/Activity").then((m) => ({ default: m.ActivityPage })),
);
const AllLeadsPage = lazy(() =>
  import("./pages/admin/AllLeads").then((m) => ({ default: m.AllLeadsPage })),
);
const OverviewPage = lazy(() =>
  import("./pages/admin/Overview").then((m) => ({ default: m.OverviewPage })),
);
const RemindersPage = lazy(() =>
  import("./pages/admin/Reminders").then((m) => ({ default: m.RemindersPage })),
);
const TeamPage = lazy(() => import("./pages/admin/Team").then((m) => ({ default: m.TeamPage })));
const UploadPage = lazy(() =>
  import("./pages/admin/Upload").then((m) => ({ default: m.UploadPage })),
);
const FollowUpsPage = lazy(() =>
  import("./pages/employee/FollowUps").then((m) => ({ default: m.FollowUpsPage })),
);
const MyLeadsPage = lazy(() =>
  import("./pages/employee/MyLeads").then((m) => ({ default: m.MyLeadsPage })),
);

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<RedirectHome />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />

        <Route element={<RequireRole role="ADMIN" />}>
          <Route path="/admin" element={<Shell tabs={ADMIN_TABS} />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="leads" element={<AllLeadsPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="reminders" element={<RemindersPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </Route>
        </Route>

        <Route element={<RequireRole role="EMPLOYEE" />}>
          <Route path="/app" element={<Shell tabs={EMPLOYEE_TABS} />}>
            <Route index element={<Navigate to="leads" replace />} />
            <Route path="leads" element={<MyLeadsPage />} />
            <Route path="follow-ups" element={<FollowUpsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<RedirectHome />} />
      </Routes>
    </Suspense>
  );
}
