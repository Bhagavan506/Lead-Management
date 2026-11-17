import { useEffect, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

export function Spinner() {
  return (
    <div role="status" aria-live="polite" className="p-10 text-center text-mu">
      Loading…
    </div>
  );
}

export function Button({
  primary,
  className = "",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      {...p}
      className={`tap cursor-pointer whitespace-nowrap rounded-lg border px-3 py-1.5 font-bold disabled:cursor-default disabled:opacity-50 ${
        primary ? "border-ac bg-ac text-on" : "border-ln bg-sf text-ink"
      } ${className}`}
    />
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-ln bg-sf p-3.5 ${className}`}>{children}</div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="font-bold text-bad">
      {children}
    </p>
  );
}

export function Tag({
  children,
  tone = "ac",
}: {
  children: ReactNode;
  tone?: "ac" | "bad" | "ok";
}) {
  const c =
    tone === "bad" ? "bg-bad/15 text-bad" : tone === "ok" ? "bg-ok/15 text-ok" : "bg-ac2 text-ac";
  return (
    <span className={`inline-block rounded-[5px] px-[7px] py-px text-xs font-bold ${c}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-[22px] text-center text-mu">{children}</div>;
}

/** Loading / error / empty wrapper so every screen handles all three the same way. */
export function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
}) {
  if (query.isPending) return <Spinner />;
  if (query.isError)
    return (
      <div role="alert" className="p-6 text-center">
        <p className="font-bold text-bad">
          {query.error instanceof Error ? query.error.message : "Something went wrong."}
        </p>
        <Button className="mt-3" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  return <>{children}</>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-[10px] border border-ln bg-sf">{children}</div>;
}
export const th = "border-b border-ln px-3 py-2 text-left text-[13px] font-normal text-mu";
export const td = "border-b border-ln px-3 py-2 align-middle";

/** Small modal that asks before something hard to undo. Escape and "Cancel" both back out. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-[rgba(10,15,20,.5)] p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-ln bg-sf p-4"
      >
        <h2 className="mb-1 text-base font-extrabold">{title}</h2>
        <div className="text-mu">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button primary onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
