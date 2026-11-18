import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";
import { ago } from "../lib/format";
import {
  currentSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupported,
} from "../lib/push";
import { Button, ErrorText, Panel, QueryState } from "./ui";

interface Mine {
  enabled: boolean;
  time: string;
  phone: string | null;
  channel?: string;
  pushAvailable?: boolean;
  devices?: number;
  recent: { id: string; messageText: string; status: string; createdAt: string }[];
}

/** What the signed-in employee is sent (push or WhatsApp), whether reminders are on, and this device's switch. */
export function ReminderPanel() {
  const q = useQuery({
    queryKey: ["reminders", "mine"],
    queryFn: () => get<Mine>("/api/reminders/mine"),
  });
  const push = q.data?.channel === "push";
  return (
    <Panel className="mb-3.5">
      <h3 className="mb-1 text-sm font-bold">{push ? "Notifications" : "WhatsApp reminders"}</h3>
      <QueryState query={q}>
        {q.data && (
          <>
            <p className="text-mu">
              {!q.data.enabled
                ? "Off. Your admin has not enabled reminders."
                : push
                  ? `On. You get a notification at ${q.data.time} when follow-ups are due, and when a lead is assigned to you.`
                  : q.data.phone
                    ? `On. You get a message at ${q.data.time} on ${q.data.phone} when follow-ups are due.`
                    : `On, but there is no WhatsApp number on your account, so nothing can be sent. Ask your admin to add it.`}
            </p>
            {q.data.pushAvailable && <DeviceSwitch devices={q.data.devices ?? 0} />}
            {q.data.recent.length === 0 ? (
              <small className="text-mu">No reminders received yet.</small>
            ) : (
              q.data.recent.map((r) => (
                <div key={r.id} className="mt-2">
                  <small className="text-mu">
                    {ago(r.createdAt)}
                    {r.status === "FAILED" && " · could not be delivered"}
                  </small>
                  <div
                    className={`max-w-[340px] rounded-[10px] px-2.5 py-2 text-[13px] ${
                      push ? "border border-ln bg-bg text-ink" : "bg-[#d9fdd3] text-[#111]"
                    }`}
                  >
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

/** Turn notifications on or off for THIS browser, and send yourself a test. */
function DeviceSwitch({ devices }: { devices: number }) {
  const qc = useQueryClient();
  const supported = pushSupported();
  const [on, setOn] = useState<boolean | null>(null); // is this browser subscribed?
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = notificationPermission() === "denied";

  useEffect(() => {
    let alive = true;
    void currentSubscription()
      .then((s) => alive && setOn(!!s))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["reminders", "mine"] });
  const fail = (e: unknown) => {
    setNote(null);
    setError(e instanceof Error ? e.message : "Something went wrong.");
  };
  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: () => {
      setError(null);
      setOn(true);
      setNote("Notifications are on for this device.");
      void refresh();
    },
    onError: fail,
  });
  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => {
      setError(null);
      setOn(false);
      setNote("Notifications are off for this device.");
      void refresh();
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: () => post("/api/push/test"),
    onSuccess: () => {
      setError(null);
      setNote("Test sent. It should appear in a moment.");
    },
    onError: fail,
  });

  if (!supported)
    return (
      <p className="mt-2 text-mu">
        This browser cannot show notifications. On an iPhone, add Leadbook to your Home Screen
        (Share, then Add to Home Screen) and open it from there.
      </p>
    );

  const busy = enable.isPending || disable.isPending || test.isPending;
  return (
    <div className="my-2">
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <>
            <Button disabled={busy} onClick={() => disable.mutate()}>
              Turn off on this device
            </Button>
            <Button disabled={busy} onClick={() => test.mutate()}>
              Send me a test
            </Button>
          </>
        ) : (
          <Button primary disabled={busy || on === null || blocked} onClick={() => enable.mutate()}>
            Turn on notifications
          </Button>
        )}
        <small className="text-mu">
          {devices === 0
            ? "No devices yet"
            : `${devices} device${devices === 1 ? "" : "s"} registered`}
        </small>
      </div>
      {blocked && !on && (
        <p className="mt-1 text-mu">
          Notifications are blocked for this site. Allow them in the browser's site settings.
        </p>
      )}
      {note && (
        <p role="status" className="mt-1 text-ok">
          {note}
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
