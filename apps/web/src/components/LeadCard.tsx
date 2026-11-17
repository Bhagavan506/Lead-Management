import { STATUS_LABEL } from "../lib/format";
import type { Lead } from "../lib/types";
import { Tag } from "./ui";

/** One lead as a tappable card. `today` (YYYY-MM-DD, app timezone) decides overdue vs due today. */
export function LeadCard({
  lead,
  today,
  onOpen,
}: {
  lead: Lead;
  today: string | undefined;
  onOpen: (id: string) => void;
}) {
  const open = lead.status !== "WON" && lead.status !== "LOST";
  const fu = lead.followUpDate;
  const overdue = !!(open && fu && today && fu < today);
  const dueToday = !!(open && fu && today && fu === today);
  return (
    <li>
      <button
        onClick={() => onOpen(lead.id)}
        className="block w-full cursor-pointer rounded-[10px] border border-ln bg-sf p-3 text-left hover:border-ac"
        aria-label={`Open ${lead.name}`}
      >
        <b className="block truncate">{lead.name}</b>
        <small className="text-mu">{lead.company}</small>
        <div className="my-1.5 flex flex-wrap items-center gap-1.5">
          <Tag>{STATUS_LABEL[lead.status]}</Tag>
          {lead.isStale && <Tag tone="bad">Stale</Tag>}
        </div>
        <small className="block text-mu">{lead.phone}</small>
        <small
          className={overdue ? "font-bold text-bad" : dueToday ? "font-bold text-ink" : "text-mu"}
        >
          {fu
            ? `Follow-up ${fu}${overdue ? " (overdue)" : dueToday ? " (today)" : ""}`
            : "No follow-up set"}
        </small>
      </button>
    </li>
  );
}
