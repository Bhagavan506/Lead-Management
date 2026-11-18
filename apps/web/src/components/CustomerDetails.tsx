import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patch } from "../lib/api";
import type { Lead, LeadDetail } from "../lib/types";
import { Button, ErrorText } from "./ui";

const FLAT_TYPES = ["1 BHK", "2 BHK", "2.5 BHK", "3 BHK", "3.5 BHK", "4 BHK", "Villa", "Studio"];

/** What the employee learns on the call. Name, community and flat number can be corrected here too. */
const values = (l: Lead) => ({
  name: l.hasName ? l.name : "",
  community: l.community,
  flatNumber: l.flatNumber,
  address: l.address,
  flatType: l.flatType,
  area: l.area,
  requirements: l.requirements,
});
type Values = ReturnType<typeof values>;

/** Read-only view, used in the admin drawer. Shows every field, "—" when not provided. */
export function CustomerDetailsView({ lead }: { lead: Lead }) {
  const rows: [string, string][] = [
    ["Community", lead.community],
    ["Flat number", lead.flatNumber],
    ["Address", lead.address],
    ["Flat type", lead.flatType],
    ["Area", lead.area],
    ["Requirements", lead.requirements],
  ];
  return (
    <section aria-label="Customer details" className="mt-4">
      <h3 className="mb-1 text-sm font-bold">Customer details</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-mu">{k}</dt>
            <dd className="whitespace-pre-wrap break-words">{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Editable form for the owning employee. Saves only what changed; the API logs it in the history. */
export function CustomerDetailsForm({ lead }: { lead: Lead }) {
  // Re-key on the saved values so the form always starts from what the server holds.
  return <Form key={JSON.stringify(values(lead))} lead={lead} />;
}

function Form({ lead }: { lead: Lead }) {
  const qc = useQueryClient();
  const saved = values(lead);
  const [v, setV] = useState<Values>(saved);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const dirty = (Object.keys(saved) as (keyof Values)[]).some((k) => v[k].trim() !== saved[k]);

  const save = useMutation({
    mutationFn: () => {
      const body: Partial<Values> = {};
      for (const k of Object.keys(saved) as (keyof Values)[])
        if (v[k].trim() !== saved[k]) body[k] = v[k].trim();
      return patch<LeadDetail>(`/api/leads/${lead.id}/details`, body);
    },
    onSuccess: (fresh) => {
      setError(null);
      setOk(true);
      qc.setQueryData(["lead", lead.id], fresh);
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => {
      setOk(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    },
  });

  const set = (k: keyof Values) => (e: { target: { value: string } }) => {
    setOk(false);
    setV((p) => ({ ...p, [k]: e.target.value }));
  };
  const field = "grid gap-0.5 text-xs font-bold text-mu";
  const input = "tap w-full text-sm font-normal text-ink";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty) save.mutate();
  }

  return (
    <form onSubmit={submit} aria-label="Customer details" className="mt-4 grid gap-2">
      <h4 className="font-bold">Customer details</h4>
      <label className={field}>
        Name
        <input value={v.name} onChange={set("name")} maxLength={200} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={field}>
          Community
          <input
            value={v.community}
            onChange={set("community")}
            maxLength={200}
            className={input}
          />
        </label>
        <label className={field}>
          Flat number
          <input
            value={v.flatNumber}
            onChange={set("flatNumber")}
            maxLength={50}
            className={input}
          />
        </label>
      </div>
      <label className={field}>
        Address
        <textarea
          value={v.address}
          onChange={set("address")}
          maxLength={1000}
          rows={2}
          className={input}
        />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={field}>
          Flat type
          <input
            value={v.flatType}
            onChange={set("flatType")}
            maxLength={100}
            list="flat-types"
            placeholder="e.g. 3 BHK"
            className={input}
          />
          <datalist id="flat-types">
            {FLAT_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className={field}>
          Area
          <input
            value={v.area}
            onChange={set("area")}
            maxLength={100}
            placeholder="e.g. 1250 sq ft"
            className={input}
          />
        </label>
      </div>
      <label className={field}>
        Specifications / customisations
        <textarea
          value={v.requirements}
          onChange={set("requirements")}
          maxLength={2000}
          rows={3}
          className={input}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" primary disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save details"}
        </Button>
        {ok && !dirty && (
          <span role="status" className="text-ok">
            Saved
          </span>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </form>
  );
}
