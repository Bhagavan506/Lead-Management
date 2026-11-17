import { Navigate, Route, Routes } from "react-router-dom";
import { RedirectHome, RequireRole } from "./components/Guards";
import { ADMIN_TABS, EMPLOYEE_TABS, Shell } from "./components/Shell";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { LoginPage } from "./pages/Login";
import { ActivityPage } from "./pages/admin/Activity";
import { AllLeadsPage } from "./pages/admin/AllLeads";
import { OverviewPage } from "./pages/admin/Overview";
import { TeamPage } from "./pages/admin/Team";
import { UploadPage } from "./pages/admin/Upload";
import { FollowUpsPage } from "./pages/employee/FollowUps";
import { MyLeadsPage } from "./pages/employee/MyLeads";
import { Placeholder } from "./pages/Placeholder";

export function App() {
  return (
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
          <Route path="reminders" element={<Placeholder title="Reminders" />} />
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
  );
}
