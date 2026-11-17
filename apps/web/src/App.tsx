import { Navigate, Route, Routes } from "react-router-dom";
import { RedirectHome, RequireRole } from "./components/Guards";
import { ADMIN_TABS, EMPLOYEE_TABS, Shell } from "./components/Shell";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { LoginPage } from "./pages/Login";
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
          <Route path="overview" element={<Placeholder title="Overview" />} />
          <Route path="leads" element={<Placeholder title="All leads" />} />
          <Route path="upload" element={<Placeholder title="Upload leads" />} />
          <Route path="team" element={<Placeholder title="Team" />} />
          <Route path="reminders" element={<Placeholder title="Reminders" />} />
          <Route path="activity" element={<Placeholder title="Activity" />} />
        </Route>
      </Route>

      <Route element={<RequireRole role="EMPLOYEE" />}>
        <Route path="/app" element={<Shell tabs={EMPLOYEE_TABS} />}>
          <Route index element={<Navigate to="leads" replace />} />
          <Route path="leads" element={<Placeholder title="My leads" />} />
          <Route path="follow-ups" element={<Placeholder title="Follow-ups" />} />
        </Route>
      </Route>

      <Route path="*" element={<RedirectHome />} />
    </Routes>
  );
}
