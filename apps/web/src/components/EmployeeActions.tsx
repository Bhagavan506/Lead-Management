import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  LOST_REASON_LABEL,
  LOST_REASONS,
  phoneDigits,
  STATUS_LABEL,
  STATUSES,
} from "../lib/format";
import type { CallOutcome, LeadDetail, LostReason, Status } from "../lib/types";
import { Button, ErrorText, Panel } from "./ui";

const OUTCOMES: [CallOutcome, string][] = [
  ["ANSWERED", "Answered"],
  ["NO_ANSWER", "No answer"],
  ["BUSY", "Busy"],
  ["WRONG_NUMBER", "Wrong number"],
];

/**
 * Everything an employee can do to THEIR lead from the drawer. The API enforces ownership; these
 * controls simply are not offered to admins (the admin drawer is read-only).
 */
export function EmployeeActions({ detail }: { detail: LeadDetail }) {
  const { lead } = detail;
  const qc = useQueryClient();
  const { user } = useAuth();
  const [askLost, setAskLost] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const closed = lead.status === "WON" || lead.status === "LOST";

  // Every action answers with the refreshed lead + history, so the drawer updates without a second request.
  const done = (fresh: LeadDetail) => {
    setError(null);
    qc.setQueryData(["lead", lead.id], fresh);
    void qc.invalidateQueries({ queryKey: ["leads"] });
    void qc.invalidateQueries({ queryKey: ["summary"] });
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong.");

  const setStatus = useMutation({
    mutationFn: (v: { status: Status; lostReason?: LostReason }) =>
      patch<LeadDetail>(`/api/leads/${lead.id}/status`, v),
    onSuccess: (d) => {
      setAskLost(false);
      done(d);
    },
    onError: fail,
  });
  const setFollowUp = useMutation({
    mutationFn: (date: string | null) =>
      patch<LeadDetail>(`/api/leads/${lead.id}/follow-up`, { date }),
    onSuccess: done,
    onError: fail,
  });
  const logCall = useMutation({
    mutationFn: (outcome: CallOutcome) =>
      post<LeadDetail>(`/api/leads/${lead.id}/calls`, { outcome }),
    onSuccess: done,
    onError: fail,
  });
  const addNote = useMutation({
    mutationFn: (text: string) => post<LeadDetail>(`/api/leads/${lead.id}/notes`, { text }),
    onSuccess: (d) => {
      setNote("");
      done(d);
    },
    onError: fail,
  });
  const contact = useMutation({
    mutationFn: (kind: "CALL" | "WHATSAPP") =>
      post<LeadDetail>(`/api/leads/${lead.id}/contact-events`, { kind }),
    onSuccess: done,
    // A failed log must never stop the call or chat itself, so this stays quiet.
  });

  const busy =
    setStatus.isPending || setFollowUp.isPending || logCall.isPending || addNote.isPending;
  const digits = phoneDigits(lead.phone);
  const first = lead.name.split(" ")[0];
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(`Hi ${first}, this is ${user?.name ?? "your account manager"} following up on your enquiry.`)}`;

  function submitNote(e: FormEvent) {
    e.preventDefault();
    if (note.trim()) addNote.mutate(note.trim());
  }

  return (
    <div className="mt-3">
      <div className="my-2 flex flex-wrap gap-1.5">
        <a
          href={`tel:+${digits}`}
          onClick={() => contact.mutate("CALL")}
          className="tap inline-flex items-center rounded-lg border border-ln bg-sf px-3 py-1.5 font-bold no-underline"
        >
          Call
        </a>
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => contact.mutate("WHATSAPP")}
          className="tap inline-flex items-center rounded-lg border border-ln bg-sf px-3 py-1.5 font-bold no-underline"
        >
          WhatsApp
        </a>
      </div>

      {askLost && (
        <Panel className="my-2">
          <b>Why was this lead lost?</b>
          <div className="my-2 flex flex-wrap gap-1.5" role="group" aria-label="Lost reason">
            {LOST_REASONS.map((r) => (
              <Button
                key={r}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ status: "LOST", lostReason: r })}
              >
                {LOST_REASON_LABEL[r]}
              </Button>
            ))}
          </div>
          <Button onClick={() => setAskLost(false)}>Cancel</Button>
        </Panel>
      )}

      <div className="mb-1.5 grid grid-cols-2 gap-2.5">
        <label className="grid gap-0.5 text-xs font-bold text-mu">
          Status
          <select
            value={lead.status}
            disabled={busy}
            onChange={(e) => {
              const status = e.target.value as Status;
              if (status === "LOST")
                setAskLost(true); // the reason is required, so ask before changing anything
              else setStatus.mutate({ status });
            }}
            className="tap w-full text-sm font-normal text-ink"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-0.5 text-xs font-bold text-mu">
          Next follow-up
          <input
            type="date"
            value={lead.followUpDate ?? ""}
            disabled={busy || closed}
            onChange={(e) => setFollowUp.mutate(e.target.value || null)}
            className="tap w-full text-sm font-normal text-ink"
          />
        </label>
      </div>
      {closed && (
        <p className="text-xs text-mu">
          Won and Lost leads have no follow-up. Reopen the lead to set one.
        </p>
      )}

      <h4 className="mt-4 mb-1 font-bold">Log a call</h4>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map(([v, label]) => (
          <Button key={v} disabled={busy} onClick={() => logCall.mutate(v)}>
            {label}
          </Button>
        ))}
      </div>

      <form onSubmit={submitNote} className="my-2 flex gap-1.5" aria-label="Add a note">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="Add a note"
          aria-label="Note"
          className="tap flex-1"
        />
        <Button type="submit" disabled={busy || !note.trim()}>
          Add note
        </Button>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
