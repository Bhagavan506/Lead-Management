import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { settings } from "../db/schema.js";

export const DEFAULT_STALE_DAYS = 2;

/** Days of inactivity after which an open lead counts as stale (rule 9). Admin setting, default 2. */
export async function getStaleDays(db: Db): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "staleDays"));
  const v = row?.value;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? v : DEFAULT_STALE_DAYS;
}
