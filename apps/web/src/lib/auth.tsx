import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "./api";

export type Role = "ADMIN" | "EMPLOYEE";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  mustChangePassword: boolean;
}

interface AuthValue {
  user: User | null;
  /** True only for the first check of "am I signed in?". */
  loading: boolean;
  /** Set when that check failed for a reason other than "not signed in" (server down, etc.). */
  error: ApiError | null;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ME = ["me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Never show one person's cached data to the next person on this browser. The "me" query itself
  // must stay registered, otherwise its observer stops receiving updates.
  const dropOtherUsersData = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME[0] });
  const me = useQuery({
    queryKey: ME,
    queryFn: async () => {
      try {
        return (await get<{ user: User }>("/api/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null; // signed out is an answer, not an error
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const value = useMemo<AuthValue>(
    () => ({
      user: me.data ?? null,
      loading: me.isPending,
      error:
        me.error instanceof ApiError
          ? me.error
          : me.error
            ? new ApiError(0, "UNKNOWN", "Something went wrong.")
            : null,
      async login(email, password) {
        const { user } = await post<{ user: User }>("/api/auth/login", { email, password });
        dropOtherUsersData();
        qc.setQueryData(ME, user);
        return user;
      },
      async logout() {
        // If this fails the session cookie is still valid, so stay signed in and let the caller say so.
        await post("/api/auth/logout");
        dropOtherUsersData();
        qc.setQueryData(ME, null);
      },
      async changePassword(currentPassword, newPassword) {
        await post("/api/auth/change-password", { currentPassword, newPassword });
        await qc.invalidateQueries({ queryKey: ME });
      },
    }),
    [me.data, me.isPending, me.error, qc],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export const homeFor = (role: Role) => (role === "ADMIN" ? "/admin/overview" : "/app/leads");
