import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../lib/api";
import { plural } from "../../lib/format";
import { useTeam } from "../../lib/queries";
import type { TeamUser } from "../../lib/types";
import {
  Button,
  ConfirmDialog,
  Empty,
  ErrorText,
  Panel,
  QueryState,
  TableWrap,
  td,
  th,
} from "../../components/ui";

interface Created {
  user: TeamUser;
  temporaryPassword: string;
}

export function TeamPage() {
  const qc = useQueryClient();
  const team = useTeam();
  const overview = useQuery({
    queryKey: ["stats", "overview"],
    queryFn: () => get<{ unassigned: number }>("/api/stats/overview"),
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TeamUser | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () => {
    for (const k of ["team-users", "stats", "leads", "lead", "activity"])
      void qc.invalidateQueries({ queryKey: [k] });
  };

  const add = useMutation({
    mutationFn: () =>
      post<Created>("/api/users", { name: name.trim(), email: email.trim(), phone: phone.trim() }),
    onSuccess: (c) => {
      setCreated(c);
      setCopied(false);
      setMessage(null);
      setName("");
      setEmail("");
      setPhone("");
      refresh();
    },
  });
  const deactivate = useMutation({
    mutationFn: (u: TeamUser) => post<{ leadsReturned: number }>(`/api/users/${u.id}/deactivate`),
    onSuccess: (r, u) => {
      setConfirm(null);
      setCreated(null);
      setMessage(
        `${u.name} deactivated. ${plural(r.leadsReturned, "open lead")} returned to the unassigned pool. Use Auto-assign to redistribute.`,
      );
      refresh();
    },
    onError: () => setConfirm(null),
  });
  const reactivate = useMutation({
    mutationFn: (u: TeamUser) => post(`/api/users/${u.id}/reactivate`),
    onSuccess: (_r, u) => {
      setMessage(`${u.name} reactivated.`);
      refresh();
    },
  });
  const auto = useMutation({
    mutationFn: () =>
      post<{ assigned: number; byEmployee: { ownerName: string; count: number }[] }>(
        "/api/leads/auto-assign",
      ),
    onSuccess: (r) => {
      setCreated(null);
      setMessage(
        r.assigned === 0
          ? "Nothing to assign: no unassigned open leads."
          : `Assigned ${plural(r.assigned, "lead")}: ${r.byEmployee.map((b) => `${b.ownerName} ${b.count}`).join(", ")}.`,
      );
      refresh();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  const employees = (team.data?.users ?? []).filter((u) => u.role === "EMPLOYEE");
  const error = add.error ?? deactivate.error ?? reactivate.error ?? auto.error;
  const unassigned = overview.data?.unassigned ?? 0;

  return (
    <>
      <Panel className="mb-3.5">
        <h3 className="mb-2 text-sm font-bold">Add employee</h3>
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-2"
          aria-label="Add employee"
        >
          {(
            [
              ["Name", name, setName, "text", "name"],
              ["Email", email, setEmail, "email", "email"],
              ["WhatsApp number", phone, setPhone, "tel", "tel"],
            ] as const
          ).map(([label, value, set, type, ac]) => (
            <label key={label} className="grid min-w-40 flex-1 gap-1 text-xs font-bold text-mu">
              {label}
              <input
                type={type}
                required
                autoComplete="off"
                data-kind={ac}
                value={value}
                onChange={(e) => set(e.target.value)}
                className="tap text-sm font-normal"
              />
            </label>
          ))}
          <Button primary type="submit" disabled={add.isPending}>
            {add.isPending ? "Adding…" : "Add employee"}
          </Button>
        </form>
        {unassigned > 0 && (
          <div className="mt-3">
            <Button onClick={() => auto.mutate()} disabled={auto.isPending}>
              {auto.isPending ? "Assigning…" : `Auto-assign unassigned leads (${unassigned})`}
            </Button>
          </div>
        )}
        {error && <ErrorText>{(error as Error).message}</ErrorText>}
        {message && (
          <p role="status" className="mt-2 font-bold text-ok">
            {message}
          </p>
        )}
        {created && (
          <div role="status" className="mt-3 rounded-lg border border-ln bg-bg p-3">
            <p className="font-bold">{created.user.name} was added.</p>
            <p className="mt-1">
              Login: <b>{created.user.email}</b>
            </p>
            <p>
              Temporary password:{" "}
              <code className="rounded bg-sf px-1.5 py-0.5 font-bold select-all">
                {created.temporaryPassword}
              </code>{" "}
              <Button
                className="ml-1 py-0.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.temporaryPassword);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </p>
            <p className="mt-1 text-mu">
              Shown only once. Share it privately; they must choose their own password at first
              sign-in.
            </p>
            <Button className="mt-2" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        )}
      </Panel>

      <QueryState query={team}>
        {employees.length === 0 ? (
          <Panel>
            <Empty>No employees yet. Add the first one above.</Empty>
          </Panel>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  {["Employee", "WhatsApp", "Open leads", "Status", ""].map((h, i) => (
                    <th key={i} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((u) => (
                  <tr key={u.id}>
                    <td className={td}>
                      <b>{u.name}</b>
                      <br />
                      <small className="text-mu">{u.email}</small>
                    </td>
                    <td className={td}>{u.phone ?? "—"}</td>
                    <td className={td}>{u.openLeads}</td>
                    <td className={td}>
                      {u.isActive ? <span className="font-bold text-ok">Active</span> : "Inactive"}
                    </td>
                    <td className={td}>
                      {u.isActive ? (
                        <Button aria-label={`Deactivate ${u.name}`} onClick={() => setConfirm(u)}>
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          aria-label={`Reactivate ${u.name}`}
                          onClick={() => reactivate.mutate(u)}
                          disabled={reactivate.isPending}
                        >
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </QueryState>

      {confirm && (
        <ConfirmDialog
          title={`Deactivate ${confirm.name}?`}
          body={`${confirm.name} has ${plural(confirm.openLeads, "open lead")}. Deactivating returns them to the unassigned pool and blocks this person from signing in. Won and Lost leads keep their history.`}
          confirmLabel="Deactivate"
          busy={deactivate.isPending}
          onConfirm={() => deactivate.mutate(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
