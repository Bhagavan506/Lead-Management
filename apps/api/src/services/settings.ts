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

export const STALE_DAYS_MIN = 1;
export const STALE_DAYS_MAX = 30;

export async function setStaleDays(db: Db, days: number): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "staleDays", value: days })
    .onConflictDoUpdate({ target: settings.key, set: { value: days } });
}

export interface ReminderSettings {
  reminderEnabled: boolean;
  /** HH:MM in APP_TIMEZONE. */
  reminderTime: string;
}
export const DEFAULT_REMINDER_TIME = "09:00";
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Off until an admin turns it on: nobody gets WhatsApp messages by accident. */
export async function getReminderSettings(db: Db): Promise<ReminderSettings> {
  const rows = await db.select().from(settings);
  const by = new Map(rows.map((r) => [r.key, r.value]));
  const enabled = by.get("reminderEnabled");
  const time = by.get("reminderTime");
  return {
    reminderEnabled: enabled === true,
    reminderTime:
      typeof time === "string" && TIME_PATTERN.test(time) ? time : DEFAULT_REMINDER_TIME,
  };
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
