import type { LostReason, Status } from "./types";

export const STATUSES: Status[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
export const STATUS_LABEL: Record<Status, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  WON: "Won",
  LOST: "Lost",
};
export const LOST_REASONS: LostReason[] = [
  "PRICE",
  "NO_RESPONSE",
  "CHOSE_COMPETITOR",
  "WRONG_CONTACT",
  "NOT_INTERESTED",
  "OTHER",
];
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  PRICE: "Price",
  NO_RESPONSE: "No response",
  CHOSE_COMPETITOR: "Chose competitor",
  WRONG_CONTACT: "Wrong contact",
  NOT_INTERESTED: "Not interested",
  OTHER: "Other",
};

/** "5 min ago", "3 h ago", "2 d ago". Dates in the future read as "just now". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "No activity";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** E.164 → "+91 98100 00001" style is locale-specific; showing it as stored is clearer and copy-safe. */
export const phoneDigits = (e164: string) => e164.replace(/\D/g, "");

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
