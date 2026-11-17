import { ReminderPanel } from "../../components/ReminderPanel";
import { EmployeeActions } from "../../components/EmployeeActions";
import { LeadCard } from "../../components/LeadCard";
import { useLeadDrawer } from "../../components/useLeadDrawer";
import { Empty, Panel, QueryState } from "../../components/ui";
import { useLeads, useSummary } from "../../lib/queries";

/** My open leads that have a follow-up date, soonest first (overdue ones come first by date). */
export function FollowUpsPage() {
  const summary = useSummary();
  const leads = useLeads({ followUp: "scheduled", page: 1, pageSize: 100 });
  const { open, drawer } = useLeadDrawer((d) => <EmployeeActions detail={d} />);
  return (
    <>
      <ReminderPanel />
      <QueryState query={leads}>
        {leads.data && leads.data.leads.length === 0 ? (
          <Panel>
            <Empty>
              No follow-ups scheduled. Set a date on a lead, or log a call with no answer.
            </Empty>
          </Panel>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
            {leads.data?.leads.map((l) => (
              <LeadCard key={l.id} lead={l} today={summary.data?.today} onOpen={open} />
            ))}
          </ul>
        )}
      </QueryState>
      {drawer}
    </>
  );
}
