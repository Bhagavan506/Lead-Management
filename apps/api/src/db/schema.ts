import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["ADMIN", "EMPLOYEE"]);
export const leadStatusEnum = pgEnum("lead_status", [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "WON",
  "LOST",
]);
export const lostReasonEnum = pgEnum("lost_reason", [
  "PRICE",
  "NO_RESPONSE",
  "CHOSE_COMPETITOR",
  "WRONG_CONTACT",
  "NOT_INTERESTED",
  "OTHER",
]);
export const activityTypeEnum = pgEnum("activity_type", [
  "UPLOADED",
  "ASSIGNED",
  "UNASSIGNED",
  "STATUS_CHANGE",
  "CALL",
  "FOLLOW_UP",
  "NOTE",
  "CONTACT_EVENT",
]);
export const reminderKindEnum = pgEnum("reminder_kind", ["SCHEDULED", "MANUAL"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Stored lower-cased by the application; the unique index is on lower(email) as a backstop.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    company: text("company").notNull().default(""),
    // E.164, e.g. +919810000001. Unique: rule 2.
    phone: text("phone").notNull(),
    source: text("source").notNull().default("Other"),
    // From the upload (all optional)...
    community: text("community").notNull().default(""),
    flatNumber: text("flat_number").notNull().default(""),
    // ...and collected by the employee on calls. Empty string = not provided.
    address: text("address").notNull().default(""),
    flatType: text("flat_type").notNull().default(""),
    area: text("area").notNull().default(""),
    requirements: text("requirements").notNull().default(""),
    status: leadStatusEnum("status").notNull().default("NEW"),
    lostReason: lostReasonEnum("lost_reason"),
    followUpDate: date("follow_up_date", { mode: "string" }),
    // Single nullable owner: rule 1.
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    // Newest activity of any kind; drives the stale rule (rule 9).
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_phone_key").on(t.phone),
    index("leads_owner_id_idx").on(t.ownerId),
    index("leads_status_idx").on(t.status),
    check("leads_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    // Rule 5: a lost reason exists exactly when the lead is Lost.
    check(
      "leads_lost_reason_matches_status",
      sql`(${t.status} = 'LOST') = (${t.lostReason} IS NOT NULL)`,
    ),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: activityTypeEnum("type").notNull(),
    // Human-readable wording copied from the prototype, e.g. "Status: New → Contacted".
    text: text("text").notNull(),
    // Structured detail (old/new owner, old/new status, outcome...).
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_lead_created_idx").on(t.leadId, t.createdAt),
    index("activities_created_idx").on(t.createdAt),
    index("activities_actor_idx").on(t.actorId),
  ],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const reminderLog = pgTable(
  "reminder_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Calendar date in APP_TIMEZONE the reminder is for.
    date: date("date", { mode: "string" }).notNull(),
    kind: reminderKindEnum("kind").notNull().default("SCHEDULED"),
    messageText: text("message_text").notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Rule 10: at most one scheduled reminder per employee per day. Manual sends are not limited here.
    uniqueIndex("reminder_log_scheduled_once")
      .on(t.employeeId, t.date)
      .where(sql`${t.kind} = 'SCHEDULED'`),
    index("reminder_log_employee_idx").on(t.employeeId),
  ],
);

// One row per browser/device an employee turned notifications on for.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The push service URL for this device. Unique: subscribing again just refreshes the row.
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_key").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Activity = typeof activities.$inferSelect;
