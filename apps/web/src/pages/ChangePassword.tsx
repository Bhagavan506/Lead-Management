import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { homeFor, useAuth } from "../lib/auth";
import { Button, ErrorText, Panel, Spinner } from "../components/ui";

/** Reached after signing in with a temporary password; the API refuses everything else until this is done. */
export function ChangePasswordPage() {
  const { user, loading, changePassword, logout } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError("Use at least 10 characters.");
    if (next !== again) return setError("The two new passwords do not match.");
    setBusy(true);
    try {
      await changePassword(current, next);
      nav(homeFor(user!.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-[8vh] max-w-[420px] px-4">
      <h1 className="mb-1 text-[19px] font-extrabold tracking-tight">Choose a new password</h1>
      {user.mustChangePassword && (
        <p className="mb-3 text-mu">
          You signed in with a temporary password. Set your own to continue.
        </p>
      )}
      <Panel>
        <form onSubmit={submit} className="grid gap-2.5" aria-label="Change password">
          {[
            ["Current password", current, setCurrent, "current-password"],
            ["New password (10+ characters)", next, setNext, "new-password"],
            ["New password again", again, setAgain, "new-password"],
          ].map(([label, value, set, ac]) => (
            <label key={label as string} className="grid gap-1 text-xs font-bold text-mu">
              {label as string}
              <input
                type="password"
                required
                autoComplete={ac as string}
                value={value as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
                className="tap text-sm font-normal"
              />
            </label>
          ))}
          {error && <ErrorText>{error}</ErrorText>}
          <Button primary type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </Button>
          <Button
            type="button"
            onClick={async () => {
              await logout();
              nav("/login", { replace: true });
            }}
          >
            Sign out
          </Button>
        </form>
      </Panel>
    </div>
  );
}
