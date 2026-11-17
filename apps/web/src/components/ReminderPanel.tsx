import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import { ago } from "../lib/format";
import { Panel, QueryState } from "./ui";

interface Mine {
  enabled: boolean;
  time: string;
  phone: string | null;
  recent: { id: string; messageText: string; status: string; createdAt: string }[];
}

/** What the signed-in employee has been sent on WhatsApp, and whether reminders are on. */
export function ReminderPanel() {
  const q = useQuery({
    queryKey: ["reminders", "mine"],
    queryFn: () => get<Mine>("/api/reminders/mine"),
  });
  return (
    <Panel className="mb-3.5">
      <h3 className="mb-1 text-sm font-bold">WhatsApp reminders</h3>
      <QueryState query={q}>
        {q.data && (
          <>
            <p className="text-mu">
              {!q.data.enabled
                ? "Off. Your admin has not enabled reminders."
                : q.data.phone
                  ? `On. You get a message at ${q.data.time} on ${q.data.phone} when follow-ups are due.`
                  : `On, but there is no WhatsApp number on your account, so nothing can be sent. Ask your admin to add it.`}
            </p>
            {q.data.recent.length === 0 ? (
              <small className="text-mu">No reminders received yet.</small>
            ) : (
              q.data.recent.map((r) => (
                <div key={r.id} className="mt-2">
                  <small className="text-mu">
                    {ago(r.createdAt)}
                    {r.status === "FAILED" && " · could not be delivered"}
                  </small>
                  <div className="max-w-[340px] rounded-[10px] bg-[#d9fdd3] px-2.5 py-2 text-[13px] text-[#111]">
                    {r.messageText}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </QueryState>
    </Panel>
  );
}
