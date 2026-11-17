import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, put } from "../../lib/api";
import { ago, dateTime, plural } from "../../lib/format";
import {
  Button,
  Empty,
  ErrorText,
  Panel,
  QueryState,
  TableWrap,
  td,
  th,
} from "../../components/ui";

interface Settings {
  staleDays: number;
  reminderEnabled: boolean;
  reminderTime: string;
}
interface Due {
  today: string;
  provider: string;
  employees: {
    employeeId: string;
    name: string;
    phone: string | null;
    leads: { id: string; name: string; followUpDate: string; overdue: boolean }[];
    message: string;
  }[];
}
interface RunSummary {
  sent: number;
  failed: number;
  alreadySent: number;
  noPhone: string[];
}
interface Log {
  items: {
    id: string;
    employeeName: string;
    date: string;
    kind: "SCHEDULED" | "MANUAL";
    status: string;
    messageText: string;
    provider: string;
    createdAt: string;
  }[];
  page: number;
  totalPages: number;
  total: number;
}

export function RemindersPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<Settings>("/api/settings"),
  });
  const due = useQuery({
    queryKey: ["reminders", "due"],
    queryFn: () => get<Due>("/api/reminders/due"),
  });
  const [logPage, setLogPage] = useState(1);
  const log = useQuery({
    queryKey: ["reminders", "log", logPage],
    queryFn: () => get<Log>(`/api/reminders/log?page=${logPage}&pageSize=20`),
    placeholderData: keepPreviousData,
  });
  const [result, setResult] = useState<RunSummary | null>(null);
  // The time box edits local text and saves when you leave it or press Enter: a time input fires
  // "change" for every typed segment, which would save half-typed times like 09:59.
  const [time, setTime] = useState("");
  useEffect(() => {
    if (settings.data) setTime(settings.data.reminderTime);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => put<Settings>("/api/settings", patch),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const sendNow = useMutation({
    mutationFn: () => post<RunSummary>("/api/reminders/send-now"),
    onSuccess: (r) => {
      setResult(r);
      setLogPage(1);
      void qc.invalidateQueries({ queryKey: ["reminders"] });
    },
  });

  const s = settings.data;
  const employees = due.data?.employees ?? [];
  const canSend = !!s?.reminderEnabled && employees.some((e) => e.phone);
  const error = save.error ?? sendNow.error;

  return (
    <>
      <Panel className="mb-3.5">
        <h3 className="mb-2 text-sm font-bold">WhatsApp follow-up reminders</h3>
        <QueryState query={settings}>
          {s && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="tap flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.reminderEnabled}
                  disabled={save.isPending}
                  onChange={(e) => save.mutate({ reminderEnabled: e.target.checked })}
                />
                Send reminders to employees
              </label>
              <label className="tap flex items-center gap-2">
                Daily at
                <input
                  type="time"
                  aria-label="Reminder time"
                  value={time}
                  disabled={save.isPending}
                  onChange={(e) => setTime(e.target.value)}
                  onBlur={() =>
                    time && time !== s.reminderTime && save.mutate({ reminderTime: time })
                  }
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    time &&
                    time !== s.reminderTime &&
                    save.mutate({ reminderTime: time })
                  }
                  className="tap"
                />
              </label>
              <span className="flex-1" />
              <Button
                primary
                disabled={!canSend || sendNow.isPending}
                onClick={() => sendNow.mutate()}
              >
                {sendNow.isPending ? "Sending…" : "Send all due now"}
              </Button>
            </div>
          )}
        </QueryState>
        <p className="mt-2 text-mu">
          Each employee gets at most one reminder a day, listing their own follow-ups that are due
          today or overdue. Times are in the server's timezone.{" "}
          {due.data?.provider === "mock" ? (
            <b className="text-ink">
              Test mode: nothing is actually sent to WhatsApp (messages are only recorded below).
            </b>
          ) : (
            due.data && <>Sending through {due.data.provider}.</>
          )}
        </p>
        {error && <ErrorText>{(error as Error).message}</ErrorText>}
        {result && (
          <p role="status" className="mt-2 font-bold">
            <span className="text-ok">Sent {plural(result.sent, "reminder")}.</span>
            {result.failed > 0 && <span className="text-bad"> {result.failed} failed.</span>}
            {result.alreadySent > 0 && (
              <span className="text-mu"> {result.alreadySent} skipped (sent a moment ago).</span>
            )}
            {result.noPhone.length > 0 && (
              <span className="text-bad"> No WhatsApp number for {result.noPhone.join(", ")}.</span>
            )}
          </p>
        )}
      </Panel>

      <h3 className="mb-2 text-sm font-bold">Due today or overdue</h3>
      <QueryState query={due}>
        {employees.length === 0 ? (
          <Panel>
            <Empty>Nobody has a follow-up due today or overdue.</Empty>
          </Panel>
        ) : (
          employees.map((e) => (
            <Panel key={e.employeeId} className="mb-2.5">
              <b>{e.name}</b> <small className="text-mu">{e.phone ?? ""}</small>
              {!e.phone && (
                <span className="font-bold text-bad">
                  {" "}
                  No WhatsApp number, so nothing can be sent
                </span>
              )}
              <div className="text-mu">
                {e.leads.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && ", "}
                    {l.name}
                    {l.overdue && <span className="font-bold text-bad"> (overdue)</span>}
                  </span>
                ))}
              </div>
              <div
                className="mt-2 max-w-[340px] rounded-[10px] bg-[#d9fdd3] px-2.5 py-2 text-[13px] text-[#111]"
                aria-label={`Message for ${e.name}`}
              >
                {e.message}
              </div>
            </Panel>
          ))
        )}
      </QueryState>

      <h3 className="mt-4 mb-2 text-sm font-bold">Sent reminders</h3>
      <QueryState query={log}>
        {log.data && log.data.items.length === 0 ? (
          <Panel>
            <Empty>No reminders sent yet.</Empty>
          </Panel>
        ) : (
          log.data && (
            <>
              <TableWrap>
                <table className="stack w-full border-collapse md:min-w-[640px]">
                  <thead>
                    <tr>
                      {["When", "Employee", "Type", "Status", "Message"].map((h) => (
                        <th key={h} className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {log.data.items.map((r) => (
                      <tr key={r.id}>
                        <td data-label="When" className={td} title={dateTime(r.createdAt)}>
                          {ago(r.createdAt)}
                        </td>
                        <td data-label="Employee" className={td}>
                          {r.employeeName}
                        </td>
                        <td data-label="Type" className={td}>
                          {r.kind === "MANUAL" ? "Send now" : "Daily"}
                        </td>
                        <td
                          data-label="Status"
                          className={`${td} ${r.status === "FAILED" ? "font-bold text-bad" : ""}`}
                        >
                          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                        </td>
                        <td data-label="Message" className={`${td} text-[13px]`}>
                          {r.messageText}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <div className="mt-3 flex items-center justify-center gap-3">
                <Button disabled={logPage <= 1} onClick={() => setLogPage(logPage - 1)}>
                  Newer
                </Button>
                <span className="text-mu">
                  Page {log.data.page} of {log.data.totalPages}
                </span>
                <Button
                  disabled={logPage >= log.data.totalPages}
                  onClick={() => setLogPage(logPage + 1)}
                >
                  Older
                </Button>
              </div>
            </>
          )
        )}
      </QueryState>
    </>
  );
}
