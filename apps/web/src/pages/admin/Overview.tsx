import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { get, put } from "../../lib/api";
import { ago, plural, STATUS_LABEL } from "../../lib/format";
import type { Status } from "../../lib/types";
import { useLeadDrawer } from "../../components/useLeadDrawer";
import { Empty, ErrorText, Panel, QueryState, TableWrap, td, th } from "../../components/ui";

interface Overview {
  total: number;
  unassigned: number;
  open: number;
  won: number;
  lost: number;
  overdue: number;
  stale: number;
  staleDays: number;
}
interface TeamRow {
  employeeId: string;
  name: string;
  assigned: number;
  notContacted: number;
  worked: number;
  won: number;
  lost: number;
  overdue: number;
  lastActivityAt: string | null;
}
interface StaleList {
  staleDays: number;
  total: number;
  leads: {
    id: string;
    name: string;
    ownerName: string | null;
    status: Status;
    lastActivityAt: string;
  }[];
}
interface LostList {
  total: number;
  reasons: { reason: string | null; label: string; count: number }[];
}

const FLOW = [
  ["1. Admin uploads leads", "CSV file or pasted rows. Duplicates are skipped."],
  ["2. Leads get one owner", "Assigned on upload or later. Never shared."],
  ["3. Employee works the lead", "Calls, notes, status, follow-ups."],
  ["4. Admin reviews the work", "Team table, activity feed, lead history."],
];

export function OverviewPage() {
  const overview = useQuery({
    queryKey: ["stats", "overview"],
    queryFn: () => get<Overview>("/api/stats/overview"),
  });
  const team = useQuery({
    queryKey: ["stats", "team"],
    queryFn: () => get<{ employees: TeamRow[] }>("/api/stats/team"),
  });
  const stale = useQuery({
    queryKey: ["stats", "stale"],
    queryFn: () => get<StaleList>("/api/stats/stale"),
  });
  const lost = useQuery({
    queryKey: ["stats", "lost"],
    queryFn: () => get<LostList>("/api/stats/lost-reasons"),
  });
  const { open, drawer } = useLeadDrawer();

  return (
    <>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
        {FLOW.map(([t, d]) => (
          <div key={t} className="rounded-[10px] border border-ln bg-sf px-3 py-2.5">
            <b className="block">{t}</b>
            <small className="text-mu">{d}</small>
          </div>
        ))}
      </div>

      <QueryState query={overview}>
        {overview.data && (
          <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <Stat label="Total leads" value={overview.data.total} />
            <Stat
              label="Unassigned"
              value={overview.data.unassigned}
              tone={overview.data.unassigned ? "bad" : undefined}
            />
            <Stat label="Won" value={overview.data.won} tone="ok" />
            <Stat
              label="Overdue follow-ups"
              value={overview.data.overdue}
              tone={overview.data.overdue ? "bad" : undefined}
            />
            <Stat
              label="Stale leads"
              value={overview.data.stale}
              tone={overview.data.stale ? "bad" : undefined}
            />
          </div>
        )}
      </QueryState>

      <h3 className="mb-2 text-sm font-bold">
        Team performance{" "}
        <small className="font-normal text-mu">(click a name to see that employee's leads)</small>
      </h3>
      <QueryState query={team}>
        {team.data && team.data.employees.length === 0 ? (
          <Panel>
            <Empty>No active employees yet. Add one on the Team tab.</Empty>
          </Panel>
        ) : (
          <TableWrap>
            <table className="stack w-full border-collapse md:min-w-[640px]">
              <thead>
                <tr>
                  {[
                    "Employee",
                    "Assigned",
                    "Not yet contacted",
                    "Worked",
                    "Won",
                    "Lost",
                    "Overdue",
                    "Last activity",
                  ].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.data?.employees.map((e) => (
                  <tr key={e.employeeId} className="hover:bg-bg">
                    <td data-label="Employee" className={td}>
                      <Link
                        className="tap inline-flex items-center font-bold underline-offset-2 hover:underline"
                        to={`/admin/leads?owner=${e.employeeId}`}
                      >
                        {e.name}
                      </Link>
                    </td>
                    <td data-label="Assigned" className={td}>
                      {e.assigned}
                    </td>
                    <td data-label="Not yet contacted" className={td}>
                      {e.notContacted}
                    </td>
                    <td data-label="Worked" className={td}>
                      {e.worked}
                    </td>
                    <td data-label="Won" className={`${td} font-bold text-ok`}>
                      {e.won}
                    </td>
                    <td data-label="Lost" className={td}>
                      {e.lost}
                    </td>
                    <td
                      data-label="Overdue"
                      className={`${td} ${e.overdue ? "font-bold text-bad" : ""}`}
                    >
                      {e.overdue}
                    </td>
                    <td data-label="Last activity" className={td}>
                      {ago(e.lastActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </QueryState>

      <StalePanel stale={stale} onOpen={open} />

      <h3 className="mt-4 mb-2 text-sm font-bold">Why leads were lost</h3>
      <QueryState query={lost}>
        <Panel>
          {lost.data && lost.data.reasons.length === 0 ? (
            <span className="text-mu">No lost leads yet.</span>
          ) : (
            lost.data?.reasons.map((r) => (
              <div key={r.reason ?? "none"}>
                {r.label}: <b>{r.count}</b>
              </div>
            ))
          )}
        </Panel>
      </QueryState>
      {drawer}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "ok" }) {
  return (
    <Panel>
      <small className="text-mu">{label}</small>
      <div
        className={`text-[28px] font-extrabold tracking-tight ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}
      >
        {value}
      </div>
    </Panel>
  );
}

function StalePanel({
  stale,
  onOpen,
}: {
  stale: UseQueryResult<StaleList>;
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = stale.data?.staleDays;
  useEffect(() => {
    if (current !== undefined) setDays(String(current));
  }, [current]);

  const save = useMutation({
    mutationFn: (n: number) => put("/api/settings", { staleDays: n }),
    onSuccess: () => {
      setError(null);
      // Stale counts appear in the overview, the stale list and every lead list.
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save."),
  });

  function commit() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setError("Enter a whole number of days from 1 to 30.");
      return;
    }
    if (n !== current) save.mutate(n);
    else setError(null);
  }

  return (
    <section className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-bold">Stale leads</h3>
        <span className="text-mu">No activity for</span>
        <input
          type="number"
          min={1}
          max={30}
          inputMode="numeric"
          aria-label="Days"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="tap w-16"
        />
        <span className="text-mu">days or more</span>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <QueryState query={stale}>
        {stale.data && stale.data.leads.length === 0 ? (
          <Panel>
            <Empty>No stale leads.</Empty>
          </Panel>
        ) : (
          <>
            <TableWrap>
              <table className="stack w-full border-collapse md:min-w-[520px]">
                <thead>
                  <tr>
                    {["Lead", "Owner", "Status", "Last activity"].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stale.data?.leads.map((l) => (
                    <tr key={l.id} className="hover:bg-bg">
                      <td data-label="Lead" className={td}>
                        <button
                          className="tap inline-flex cursor-pointer items-center font-bold underline-offset-2 hover:underline"
                          onClick={() => onOpen(l.id)}
                        >
                          {l.name}
                        </button>
                      </td>
                      <td data-label="Owner" className={td}>
                        {l.ownerName ?? "Unassigned"}
                      </td>
                      <td data-label="Status" className={td}>
                        {STATUS_LABEL[l.status]}
                      </td>
                      <td data-label="Last activity" className={`${td} font-bold text-bad`}>
                        {ago(l.lastActivityAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {stale.data && stale.data.total > stale.data.leads.length && (
              <p className="mt-1 text-mu">
                Showing the {plural(stale.data.leads.length, "stalest lead")} of {stale.data.total}.
              </p>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
