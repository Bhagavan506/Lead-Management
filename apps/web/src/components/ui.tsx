import type { ButtonHTMLAttributes, ReactNode } from "react";

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
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
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
