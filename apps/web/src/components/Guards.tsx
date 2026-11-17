import { Navigate, Outlet, useLocation } from "react-router-dom";
import { homeFor, useAuth, type Role } from "../lib/auth";
import { Spinner } from "./ui";

/** Waits for the "who am I" check, so a reload on a protected page never flashes the login screen. */
export function RequireRole({ role }: { role: Role }) {
  const { user, loading, error } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (error) return <ServerDown message={error.message} />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  // Wrong role: send them to their own home, never show another role's screens.
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

export function RedirectHome() {
  const { user, loading, error } = useAuth();
  if (loading) return <Spinner />;
  if (error) return <ServerDown message={error.message} />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

export function ServerDown({ message }: { message: string }) {
  return (
    <div role="alert" className="mx-auto mt-[8vh] max-w-md px-4 text-center">
      <h1 className="text-lg font-extrabold">Can't load Leadbook</h1>
      <p className="mt-2 text-mu">{message}</p>
      <button
        className="tap mt-4 rounded-lg border border-ln bg-sf px-3 py-2 font-bold"
        onClick={() => location.reload()}
      >
        Try again
      </button>
    </div>
  );
}
