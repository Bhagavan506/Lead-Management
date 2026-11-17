import { useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../lib/api";
import { useTeam } from "../../lib/queries";
import { Button, ErrorText, Panel, TableWrap, td, th } from "../../components/ui";

type Mode = "none" | "split" | "owner";
interface Issue {
  row: number;
  name: string;
  phone: string;
  reason: string;
}
interface Report {
  summary: {
    rows: number;
    added: number;
    skipped: number;
    skippedInFile: number;
    skippedExisting: number;
    invalid: number;
  };
  skipped: Issue[];
  invalid: Issue[];
  reportTruncated: boolean;
  assignment: { mode: Mode; assigned: { ownerId: string; ownerName: string; count: number }[] };
}

const MAX_BYTES = 5 * 1024 * 1024;
const SAMPLE = "name,company,phone,source\nAsha Rao,Acme Ltd,98100 00001,Website\n";

export function UploadPage() {
  const qc = useQueryClient();
  const team = useTeam();
  const active = (team.data?.users ?? []).filter((u) => u.role === "EMPLOYEE" && u.isActive);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [ownerId, setOwnerId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () =>
      post<Report>("/api/leads/upload", { csv, mode, ...(mode === "owner" ? { ownerId } : {}) }),
    onSuccess: () => {
      for (const k of ["leads", "stats", "team-users", "activity"])
        void qc.invalidateQueries({ queryKey: [k] });
    },
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!f) return;
    setLocalError(null);
    if (f.size > MAX_BYTES)
      return setLocalError("That file is larger than 5 MB. Split it into smaller files.");
    setCsv(await f.text());
    setFileName(f.name);
    upload.reset();
  }

  function submit() {
    setLocalError(null);
    if (!csv.trim()) return setLocalError("Choose a file or paste your rows first.");
    if (mode === "owner" && !ownerId)
      return setLocalError("Choose which employee gets these leads.");
    upload.mutate();
  }

  const r = upload.data;
  return (
    <>
      <Panel className="mb-3.5">
        <h3 className="mb-1 text-sm font-bold">Upload leads</h3>
        <p className="text-mu">
          Columns: <b>name</b>, <b>company</b>, <b>phone</b>, <b>source</b> (first row is the
          header). Phone numbers without a country code are treated as Indian numbers. Duplicates
          are skipped.{" "}
          <a
            className="underline"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`}
            download="leadbook-sample.csv"
          >
            Download a sample
          </a>
        </p>

        <div className="my-3 flex flex-wrap items-center gap-2">
          <label className="tap cursor-pointer rounded-lg border border-ln bg-sf px-3 py-1.5 font-bold">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onFile}
              className="sr-only"
            />
          </label>
          {fileName && <span className="text-mu">{fileName}</span>}
        </div>
        <label className="grid gap-1 text-xs font-bold text-mu">
          …or paste rows
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setFileName(null);
            }}
            placeholder={SAMPLE}
            className="min-h-28 w-full font-mono text-[13px] font-normal"
          />
        </label>

        <fieldset className="mt-3 grid gap-1.5">
          <legend className="mb-1 text-xs font-bold text-mu">Who gets the new leads?</legend>
          {(
            [
              ["none", "Nobody yet (they wait in the unassigned pool)"],
              ["split", "Split evenly between active employees (fewest open leads first)"],
              ["owner", "One employee"],
            ] as [Mode, string][]
          ).map(([v, label]) => (
            <label key={v} className="tap flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value={v}
                checked={mode === v}
                onChange={() => setMode(v)}
              />
              {label}
            </label>
          ))}
          {mode === "owner" && (
            <select
              aria-label="Employee"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="tap max-w-xs"
            >
              <option value="">Choose an employee</option>
              {active.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        {(localError || upload.error) && (
          <ErrorText>{localError ?? (upload.error as Error).message}</ErrorText>
        )}
        <div className="mt-3">
          <Button primary onClick={submit} disabled={upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </Panel>

      {r && (
        <Panel>
          <h3 className="mb-1 text-sm font-bold">Result</h3>
          <p role="status" className="text-[15px]">
            <b className="text-ok">{r.summary.added} added</b>
            {" · "}
            {r.summary.skipped} skipped as duplicates ({r.summary.skippedInFile} repeated in the
            file, {r.summary.skippedExisting} already in Leadbook)
            {" · "}
            <b className={r.summary.invalid ? "text-bad" : ""}>{r.summary.invalid} invalid</b>
            {" · "}
            {r.summary.rows} rows read
          </p>
          {r.assignment.assigned.length > 0 && (
            <p className="mt-1 text-mu">
              Assigned: {r.assignment.assigned.map((a) => `${a.ownerName} ${a.count}`).join(", ")}
            </p>
          )}
          <IssueTable title="Invalid rows (not added)" rows={r.invalid} />
          <IssueTable title="Skipped duplicates" rows={r.skipped} />
          {r.reportTruncated && (
            <p className="mt-2 text-mu">Only the first rows of each list are shown.</p>
          )}
        </Panel>
      )}
    </>
  );
}

function IssueTable({ title, rows }: { title: string; rows: Issue[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="mb-1 text-sm font-bold">{title}</h4>
      <TableWrap>
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr>
              {["Row", "Name", "Phone", "Why"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={`${i.row}-${i.phone}`}>
                <td className={td}>{i.row}</td>
                <td className={td}>{i.name || "—"}</td>
                <td className={td}>{i.phone || "—"}</td>
                <td className={td}>{i.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
