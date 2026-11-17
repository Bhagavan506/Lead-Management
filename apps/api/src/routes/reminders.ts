import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { dateInTz } from "../lib/dates.js";
import type { SessionUser } from "../plugins/auth.js";
import { buildReminder } from "../services/reminder-message.js";
import {
  dueByEmployee,
  recentForEmployee,
  reminderLogPage,
  runReminders,
} from "../services/reminders.js";
import { getReminderSettings } from "../services/settings.js";

const logQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function reminderRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.guard("ADMIN") };
  const tz = () => app.config.APP_TIMEZONE;

  // What would be sent right now: each employee's due or overdue follow-ups and the message text.
  app.get("/due", admin, async () => {
    const today = dateInTz(tz());
    const employees = (await dueByEmployee(app.db, today)).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      phone: e.phone,
      leads: e.due.map((d) => ({
        id: d.leadId,
        name: d.name,
        followUpDate: d.followUpDate,
        overdue: d.followUpDate < today,
      })),
      message: buildReminder(e.name, e.due, today).text,
    }));
    return { today, employees };
  });

  app.post("/send-now", admin, async () => {
    const { reminderEnabled } = await getReminderSettings(app.db);
    if (!reminderEnabled)
      throw new AppError(409, "REMINDERS_DISABLED", "Turn reminders on before sending");
    return runReminders(app.db, app.whatsapp, { kind: "MANUAL", timeZone: tz() });
  });

  app.get("/log", admin, async (req) => {
    const q = logQuery.parse(req.query);
    return reminderLogPage(app.db, q.page, q.pageSize);
  });

  // The employee's own panel: are reminders on, where do they go, and the last few they received.
  app.get("/mine", { preHandler: app.guard("EMPLOYEE") }, async (req) => {
    const user = req.user as SessionUser;
    const { reminderEnabled, reminderTime } = await getReminderSettings(app.db);
    return {
      enabled: reminderEnabled,
      time: reminderTime,
      phone: user.phone,
      recent: await recentForEmployee(app.db, user.id),
    };
  });
}
