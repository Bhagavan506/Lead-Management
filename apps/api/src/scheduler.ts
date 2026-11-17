import type { FastifyInstance } from "fastify";
import { dateInTz } from "./lib/dates.js";
import { runReminders } from "./services/reminders.js";
import { getReminderSettings } from "./services/settings.js";

/** HH:MM on the clock in `timeZone`. */
export function timeInTz(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/**
 * Runs the scheduled reminders once per day, after the admin's chosen time. It checks every minute and
 * also right after start-up, so a restart after the send time still sends that day's reminders.
 * Correctness does not depend on this loop being the only one running: the database refuses a second
 * scheduled reminder for the same employee and day (rule 10), so extra processes or restarts are harmless.
 */
export function startScheduler(
  app: FastifyInstance,
  { everyMs = 60_000, immediate = true }: { everyMs?: number; immediate?: boolean } = {},
) {
  let lastDay = "";
  let running = false;

  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      const { reminderEnabled, reminderTime } = await getReminderSettings(app.db);
      if (!reminderEnabled) return;
      const tz = app.config.APP_TIMEZONE;
      const day = dateInTz(tz, 0, now);
      if (day === lastDay || timeInTz(tz, now) < reminderTime) return;
      const summary = await runReminders(app.db, app.whatsapp, {
        kind: "SCHEDULED",
        timeZone: tz,
        now,
      });
      lastDay = day;
      app.log.info({ reminders: summary }, "scheduled reminders run");
    } catch (err) {
      app.log.error(err, "scheduled reminders failed"); // tried again on the next tick
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  if (immediate) void tick();
  return { tick, stop: () => clearInterval(timer) };
}
