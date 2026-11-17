import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../lib/api";
import { ago, plural, STATUS_LABEL, STATUSES } from "../../lib/format";
import { useLeads, useTeam } from "../../lib/queries";
import type { Lead, TeamUser } from "../../lib/types";
import { useMedia } from "../../lib/useMedia";
import { useLeadDrawer } from "../../components/useLeadDrawer";
import {
  Button,
  Empty,
  ErrorText,
  Panel,
  QueryState,
  Tag,
  TableWrap,
  td,
  th,
} from "../../components/ui";

const PAGE_SIZE = 25;

export function AllLeadsPage() {
  const [params, setParams] = useSearchParams();
  const owner = params.get("owner") ?? "";
  const status = params.get("status") ?? "";
  const stale = params.get("stale") === "true";
  const search = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v) n.set(k, v);
        else n.delete(k);
      }
      if (!("page" in patch)) n.delete("page"); // any filter change starts again at page 1
      return n;
    });

  // The box edits local text; the URL (and the request) follow 300 ms after typing stops.
  const [text, setText] = useState(search);
  useEffect(() => setText(search), [search]);
  useEffect(() => {
    if (text === search) return;
    const t = setTimeout(() => set({ q: text.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [text]);

  const team = useTeam();
  const leads = useLeads({
    owner: owner || undefined,
    status: status || undefined,
    stale: stale || undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const { open, drawer } = useLeadDrawer();
  const wide = useMedia("(min-width: 768px)");
  const employees = (team.data?.users ?? []).filter((u) => u.role === "EMPLOYEE");
  const active = employees.filter((u) => u.isActive);
  const anyFilter = !!(owner || status || stale || search);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search leads"
          placeholder="Search name, company or phone"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="tap min-w-0 flex-1 basis-48"
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => set({ status: e.target.value || null })}
          className="tap"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by owner"
          value={owner}
          onChange={(e) => set({ owner: e.target.value || null })}
          className="tap"
        >
          <option value="">All owners</option>
          <option value="none">Unassigned</option>
          {employees.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
        <label className="tap flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={stale}
            onChange={(e) => set({ stale: e.target.checked ? "true" : null })}
          />
          Stale only
        </label>
        {anyFilter && (
          <Button onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>
        )}
      </div>

      <QueryState query={leads}>
        {leads.data && leads.data.leads.length === 0 ? (
          <Panel>
            <Empty>
              {anyFilter
                ? "No leads match these filters."
                : "No leads yet. Upload some on the Upload leads tab."}
            </Empty>
          </Panel>
        ) : (
          leads.data && (
            <>
              <p className="mb-2 text-mu" aria-live="polite">
                {plural(leads.data.total, "lead")}
                {leads.isFetching && " · updating…"}
              </p>
              {wide ? (
                <LeadTable rows={leads.data.leads} people={active} onOpen={open} />
              ) : (
                <LeadCards rows={leads.data.leads} people={active} onOpen={open} />
              )}
              <div className="mt-3 flex items-center justify-center gap-3">
                <Button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                  Previous
                </Button>
                <span className="text-mu">
                  Page {leads.data.page} of {leads.data.totalPages}
                </span>
                <Button
                  disabled={page >= leads.data.totalPages}
                  onClick={() => set({ page: String(page + 1) })}
                >
                  Next
                </Button>
              </div>
            </>
          )
        )}
      </QueryState>
      {drawer}
    </>
  );
}

/** Reassign dropdown. Choosing "Unassigned" returns the lead to the pool. One owner at a time (rule 1). */
function OwnerSelect({ lead, people }: { lead: Lead; people: TeamUser[] }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const assign = useMutation({
    mutationFn: (ownerId: string | null) => post(`/api/leads/${lead.id}/assign`, { ownerId }),
    onSuccess: () => {
      setError(null);
      for (const k of ["leads", "lead", "stats", "team-users", "activity"])
        void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not reassign."),
  });
  // An inactive previous owner is not selectable, but must still be shown as the current value.
  const listed = lead.ownerId && !people.some((p) => p.id === lead.ownerId);
  return (
    <div>
      <select
        aria-label={`Owner of ${lead.name}`}
        value={lead.ownerId ?? ""}
        disabled={assign.isPending}
        onChange={(e) => assign.mutate(e.target.value || null)}
        className="tap max-w-full"
      >
        <option value="">Unassigned</option>
        {listed && <option value={lead.ownerId as string}>{lead.ownerName}</option>}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

type RowProps = { rows: Lead[]; people: TeamUser[]; onOpen: (id: string) => void };

function LeadTable({ rows, people, onOpen }: RowProps) {
  return (
    <TableWrap>
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            {["Lead", "Status", "Owner", "Follow-up", "Last activity"].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="hover:bg-bg">
              <td className={td}>
                <button
                  className="cursor-pointer text-left font-bold underline-offset-2 hover:underline"
                  onClick={() => onOpen(l.id)}
                >
                  {l.name}
                </button>
                <br />
                <small className="text-mu">
                  {l.company} · {l.phone}
                </small>
              </td>
              <td className={td}>
                <Tag>{STATUS_LABEL[l.status]}</Tag>
              </td>
              <td className={td}>
                <OwnerSelect lead={l} people={people} />
              </td>
              <td className={td}>{l.followUpDate ?? "—"}</td>
              <td className={td}>
                {l.lastActivityText ?? "—"}
                <br />
                <small className={l.isStale ? "font-bold text-bad" : "text-mu"}>
                  {ago(l.lastActivityAt)}
                  {l.isStale && " · Stale"}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function LeadCards({ rows, people, onOpen }: RowProps) {
  return (
    <ul className="grid gap-2">
      {rows.map((l) => (
        <li key={l.id} className="rounded-[10px] border border-ln bg-sf p-3">
          <div className="flex items-start gap-2">
            <button
              className="min-w-0 flex-1 cursor-pointer text-left"
              onClick={() => onOpen(l.id)}
            >
              <b className="block truncate">{l.name}</b>
              <small className="text-mu">
                {l.company} · {l.phone}
              </small>
            </button>
            <Tag>{STATUS_LABEL[l.status]}</Tag>
          </div>
          <div className="mt-1.5 text-[13px]">
            <span className={l.isStale ? "font-bold text-bad" : "text-mu"}>
              {ago(l.lastActivityAt)}
              {l.isStale && " · Stale"}
            </span>
            {l.followUpDate && <span className="text-mu"> · Follow-up {l.followUpDate}</span>}
          </div>
          <div className="mt-2">
            <OwnerSelect lead={l} people={people} />
          </div>
        </li>
      ))}
    </ul>
  );
}
