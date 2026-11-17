import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../lib/api";
import { homeFor, useAuth, type User } from "../lib/auth";
import { Button, ErrorText, Panel, Spinner } from "../components/ui";

/** Where to go after signing in: back to where they were headed, if their role may be there. */
function destination(u: User, from: string | undefined) {
  if (u.mustChangePassword) return "/change-password";
  return from && from.startsWith(u.role === "ADMIN" ? "/admin" : "/app") ? from : homeFor(u.role);
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (user) return <Navigate to={destination(user, from)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password); // the redirect above takes over once the user is set
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? `Too many attempts. Try again in ${Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))} min.`
          : err instanceof ApiError && err.status === 401
            ? "Email or password is incorrect."
            : err instanceof ApiError
              ? err.message
              : "Something went wrong.",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-[8vh] max-w-[420px] px-4">
      <h1 className="mb-3 text-[19px] font-extrabold tracking-tight">Leadbook</h1>
      <Panel>
        <form onSubmit={submit} className="grid gap-2.5" aria-label="Sign in">
          <label className="grid gap-1 text-xs font-bold text-mu">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="tap text-sm font-normal"
            />
          </label>
          <label className="grid gap-1 text-xs font-bold text-mu">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="tap text-sm font-normal"
            />
          </label>
          {error && <ErrorText>{error}</ErrorText>}
          <Button primary type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
