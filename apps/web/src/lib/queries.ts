import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "./api";
import type { LeadDetail, LeadList, TeamUser } from "./types";

export interface LeadFilters {
  owner?: string;
  status?: string;
  stale?: boolean;
  search?: string;
  page: number;
  pageSize?: number;
}

export const qs = (o: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const useLeads = (f: LeadFilters) =>
  useQuery({
    queryKey: ["leads", f],
    queryFn: () => get<LeadList>(`/api/leads${qs({ ...f })}`),
    placeholderData: keepPreviousData,
  });

export const useLeadDetail = (id: string | null) =>
  useQuery({
    queryKey: ["lead", id],
    queryFn: () => get<LeadDetail>(`/api/leads/${id}`),
    enabled: !!id,
    retry: false,
  });

export const useTeam = () =>
  useQuery({ queryKey: ["team-users"], queryFn: () => get<{ users: TeamUser[] }>("/api/users") });
