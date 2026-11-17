import { and, count, inArray, isNotNull, notInArray } from "drizzle-orm";
import { leads } from "../db/schema.js";
import type { Tx } from "./locks.js";

export interface Candidate {
  id: string;
  name: string;
  createdAt: Date;
}

/** Open leads (not Won/Lost) currently owned by each candidate. Closed leads do not count as load. */
export async function openLoads(tx: Tx, employees: Candidate[]): Promise<Map<string, number>> {
  const load = new Map<string, number>(employees.map((e) => [e.id, 0]));
  if (employees.length === 0) return load;
  const rows = await tx
    .select({ ownerId: leads.ownerId, n: count() })
    .from(leads)
    .where(
      and(
        isNotNull(leads.ownerId),
        inArray(
          leads.ownerId,
          employees.map((e) => e.id),
        ),
        notInArray(leads.status, ["WON", "LOST"]),
      ),
    )
    .groupBy(leads.ownerId);
  for (const r of rows) load.set(r.ownerId as string, r.n);
  return load;
}

/**
 * Gives each item, in order, to the currently least-loaded employee (as in the prototype).
 * Ties go to the longest-standing account, then by id, so the result is deterministic.
 * Mutates `load`. Returns employeeId -> items.
 */
export function distributeLeastLoaded<T>(
  employees: Candidate[],
  load: Map<string, number>,
  items: T[],
): Map<string, T[]> {
  const order = [...employees].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const out = new Map<string, T[]>();
  for (const item of items) {
    const pick = order.reduce((best, e) =>
      (load.get(e.id) as number) < (load.get(best.id) as number) ? e : best,
    );
    load.set(pick.id, (load.get(pick.id) as number) + 1);
    out.set(pick.id, [...(out.get(pick.id) ?? []), item]);
  }
  return out;
}
