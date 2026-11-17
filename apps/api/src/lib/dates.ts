/** Calendar date (YYYY-MM-DD) in the given IANA timezone, offset by `plusDays`. */
export function dateInTz(timeZone: string, plusDays = 0, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}
