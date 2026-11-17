import { useEffect, useRef, type ReactNode } from "react";
import { useLeadDetail } from "../lib/queries";
import { ApiError } from "../lib/api";
import { dateTime, LOST_REASON_LABEL, STATUS_LABEL } from "../lib/format";
import type { LeadDetail } from "../lib/types";
import { Button, Spinner, Tag } from "./ui";

/**
 * Side drawer for one lead with its full history. Read-only by itself; the employee screens pass
 * working controls as `actions`. A lead that is missing or belongs to someone else is the same
 * "not found" message (the API answers 404 for both, so nothing about it leaks).
 */
export function LeadDrawer({
  leadId,
  onClose,
  actions,
}: {
  leadId: string;
  onClose: () => void;
  actions?: (d: LeadDetail) => ReactNode;
}) {
  const q = useLeadDetail(leadId);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind must not scroll
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const notFound =
    q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 422);
  const d = q.data;

  return (
    <div
      className="fixed inset-0 z-10 flex justify-end bg-[rgba(10,15,20,.5)]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={d ? `Lead: ${d.lead.name}` : "Lead"}
        className="h-full w-[min(460px,100%)] overflow-auto bg-sf p-[18px] pt-[calc(18px+env(safe-area-inset-top))] pb-[calc(18px+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-extrabold">{d ? d.lead.name : "Lead"}</h2>
          <Button onClick={onClose} aria-label="Close" ref={closeRef}>
            Close
          </Button>
        </div>

        {q.isPending && <Spinner />}
        {notFound && (
          <p role="alert" className="mt-4 font-bold text-bad">
            Lead not found.
          </p>
        )}
        {q.isError && !notFound && (
          <div role="alert" className="mt-4">
            <p className="font-bold text-bad">{(q.error as Error).message}</p>
            <Button className="mt-2" onClick={() => q.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {d && (
          <>
            <p className="text-mu">
              {d.lead.company} · {d.lead.phone}
            </p>
            <div className="my-3 flex flex-wrap items-center gap-2">
              <Tag>{STATUS_LABEL[d.lead.status]}</Tag>
              {d.lead.lostReason && <Tag tone="bad">{LOST_REASON_LABEL[d.lead.lostReason]}</Tag>}
              {d.lead.isStale && <Tag tone="bad">Stale</Tag>}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-mu">Owner</dt>
              <dd>{d.lead.ownerName ?? "Unassigned"}</dd>
              <dt className="text-mu">Follow-up</dt>
              <dd>{d.lead.followUpDate ?? "None"}</dd>
              <dt className="text-mu">Source</dt>
              <dd>{d.lead.source || "—"}</dd>
            </dl>

            {actions?.(d)}

            <h3 className="mt-5 mb-1 text-sm font-bold">History</h3>
            {d.timeline.length === 0 ? (
              <p className="text-mu">No history yet.</p>
            ) : (
              <ol>
                {d.timeline.map((t) => (
                  <li key={t.id} className="border-b border-ln py-1.5 text-[13px]">
                    {t.text}
                    <small className="block text-mu">
                      {t.actorName} · {dateTime(t.createdAt)}
                    </small>
                  </li>
                ))}
              </ol>
            )}
            {d.timelineTruncated && (
              <p className="mt-2 text-mu">Showing the most recent entries only.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
