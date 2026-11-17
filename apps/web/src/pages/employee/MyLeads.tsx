import { useState } from "react";
import { EmployeeActions } from "../../components/EmployeeActions";
import { LeadCard } from "../../components/LeadCard";
import { useLeadDrawer } from "../../components/useLeadDrawer";
import { Button, Empty, Panel, QueryState } from "../../components/ui";
import { plural } from "../../lib/format";
import { useLeads, useSummary } from "../../lib/queries";

const PAGE_SIZE = 50;

export function MyLeadsPage() {
  const [page, setPage] = useState(1);
  const summary = useSummary();
  const leads = useLeads({ page, pageSize: PAGE_SIZE });
  const { open, drawer } = useLeadDrawer((d) => <EmployeeActions detail={d} />);
  const s = summary.data;

  return (
    <>
      <p className="mb-3 text-mu">You only see leads assigned to you. Nobody else can work them.</p>
      {s && (
        <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Tile label="My leads" value={s.total} />
          <Tile label="Not yet contacted" value={s.notContacted} />
          <Tile
            label="Follow-ups due"
            value={s.followUpsDue}
            tone={s.followUpsDue ? "bad" : undefined}
          />
          <Tile label="Won" value={s.won} tone="ok" />
        </div>
      )}
      <QueryState query={leads}>
        {leads.data && leads.data.leads.length === 0 ? (
          <Panel>
            <Empty>Nothing here. Ask your admin to assign leads.</Empty>
          </Panel>
        ) : (
          leads.data && (
            <>
              <p className="sr-only" aria-live="polite">
                {plural(leads.data.total, "lead")}
              </p>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
                {leads.data.leads.map((l) => (
                  <LeadCard key={l.id} lead={l} today={s?.today} onOpen={open} />
                ))}
              </ul>
              {leads.data.totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-3">
                  <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <span className="text-mu">
                    Page {leads.data.page} of {leads.data.totalPages}
                  </span>
                  <Button
                    disabled={page >= leads.data.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )
        )}
      </QueryState>
      {drawer}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "bad" | "ok" }) {
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
