import path from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import { eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "./client.js";
import { activities, leads, settings, users } from "./schema.js";
import { normalizePhone } from "../lib/phone.js";
import { dateInTz } from "../lib/dates.js";

type Status = "NEW" | "CONTACTED" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
type LostReason =
  "PRICE" | "NO_RESPONSE" | "CHOSE_COMPETITOR" | "WRONG_CONTACT" | "NOT_INTERESTED" | "OTHER";
type ActType = typeof activities.$inferInsert.type;

export interface SeedOptions {
  password: string;
  defaultCountry: string;
  timeZone: string;
  now?: Date;
}

const HOUR = 3_600_000;

const EMPLOYEES = [
  { key: "e1", name: "Priya Sharma", email: "priya@demo.com", phone: "+91 98200 00001" },
  { key: "e2", name: "Rohan Verma", email: "rohan@demo.com", phone: "+91 98200 00002" },
  { key: "e3", name: "Anita Das", email: "anita@demo.com", phone: "+91 98200 00003" },
] as const;

type ActorKey = "a" | (typeof EMPLOYEES)[number]["key"];
// [hours ago, actor, type, text]
type Act = [number, ActorKey, ActType, string];

interface LeadSeed {
  name: string;
  company: string;
  phone: string;
  source: string;
  owner: ActorKey | null;
  status: Status;
  lostReason?: LostReason;
  followUpInDays: number | null;
  acts: Act[];
}

// Mirrors the 9 leads in reference/leadbook-flow-demo.html.
const LEADS: LeadSeed[] = [
  {
    name: "Aarav Mehta",
    company: "Northwind Traders",
    phone: "9810000001",
    source: "Website",
    owner: "e1",
    status: "QUALIFIED",
    followUpInDays: 1,
    acts: [
      [50, "e1", "CALL", "Call: Answered"],
      [49, "e1", "STATUS_CHANGE", "Status: New → Contacted"],
      [20, "e1", "STATUS_CHANGE", "Status: Contacted → Qualified"],
      [20, "e1", "NOTE", "Note: Wants pricing for 20 seats"],
    ],
  },
  {
    name: "Sara Khan",
    company: "Brightpath Schools",
    phone: "9810000002",
    source: "Referral",
    owner: "e1",
    status: "CONTACTED",
    followUpInDays: -1,
    acts: [[30, "e1", "CALL", "Call: No answer"]],
  },
  {
    name: "Dev Patel",
    company: "Orbit Logistics",
    phone: "9810000003",
    source: "Event",
    owner: "e2",
    status: "PROPOSAL",
    followUpInDays: 2,
    acts: [
      [40, "e2", "CALL", "Call: Answered"],
      [10, "e2", "STATUS_CHANGE", "Status: Qualified → Proposal"],
    ],
  },
  {
    name: "Meera Iyer",
    company: "Lumen Clinics",
    phone: "9810000004",
    source: "Website",
    owner: "e2",
    status: "NEW",
    followUpInDays: 0,
    acts: [],
  },
  {
    name: "Kabir Singh",
    company: "Zenith Foods",
    phone: "9810000005",
    source: "Cold outreach",
    owner: "e3",
    status: "WON",
    followUpInDays: null,
    acts: [
      [60, "e3", "CALL", "Call: Answered"],
      [5, "e3", "STATUS_CHANGE", "Status: Proposal → Won"],
    ],
  },
  {
    name: "Nisha Rao",
    company: "Pixel Forge",
    phone: "9810000006",
    source: "Social",
    owner: "e3",
    status: "LOST",
    lostReason: "WRONG_CONTACT",
    followUpInDays: null,
    acts: [
      [24, "e3", "CALL", "Call: Wrong number"],
      [23, "e3", "STATUS_CHANGE", "Status: Contacted → Lost (Wrong contact)"],
    ],
  },
  {
    name: "Imran Ali",
    company: "Delta Print",
    phone: "9810000007",
    source: "Website",
    owner: null,
    status: "NEW",
    followUpInDays: null,
    acts: [],
  },
  {
    name: "Tara Nair",
    company: "Greenleaf Cafe",
    phone: "9810000008",
    source: "Referral",
    owner: null,
    status: "NEW",
    followUpInDays: null,
    acts: [],
  },
  {
    name: "Vikram Joshi",
    company: "Atlas Steel",
    phone: "9810000009",
    source: "Event",
    owner: null,
    status: "NEW",
    followUpInDays: null,
    acts: [],
  },
];

/**
 * Idempotent: users are matched by email, leads by phone, settings by key.
 * A lead's history is written only when the lead has none, so re-running never duplicates
 * (activities are append-only and cannot be reset).
 */
export async function seed(db: Db, opts: SeedOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const passwordHash = await argon2.hash(opts.password);

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(users)
      .where(inArray(users.email, ["admin@demo.com", ...EMPLOYEES.map((e) => e.email)]));
    const byEmail = new Map(existing.map((u) => [u.email, u]));

    const ids = new Map<ActorKey, string>();
    const wanted: {
      key: ActorKey;
      name: string;
      email: string;
      role: "ADMIN" | "EMPLOYEE";
      phone: string | null;
    }[] = [
      { key: "a", name: "Admin", email: "admin@demo.com", role: "ADMIN", phone: null },
      ...EMPLOYEES.map((e) => ({
        key: e.key,
        name: e.name,
        email: e.email,
        role: "EMPLOYEE" as const,
        phone: normalizePhone(e.phone, opts.defaultCountry),
      })),
    ];
    for (const u of wanted) {
      const found = byEmail.get(u.email);
      if (found) {
        ids.set(u.key, found.id);
        continue;
      }
      const [row] = await tx
        .insert(users)
        .values({ name: u.name, email: u.email, role: u.role, phone: u.phone, passwordHash })
        .returning({ id: users.id });
      ids.set(u.key, (row as { id: string }).id);
    }
    const actor = (k: ActorKey) => ids.get(k) as string;

    for (const l of LEADS) {
      const phone = normalizePhone(l.phone, opts.defaultCountry);
      if (!phone) throw new Error(`Seed lead ${l.name} has an invalid phone: ${l.phone}`);

      const [found] = await tx.select().from(leads).where(eq(leads.phone, phone));
      let leadId = found?.id;
      if (!leadId) {
        const uploadedAt = new Date(now.getTime() - 72 * HOUR);
        const times = [uploadedAt, ...l.acts.map((a) => new Date(now.getTime() - a[0] * HOUR))];
        const latest = new Date(Math.max(...times.map((t) => t.getTime())));
        const [row] = await tx
          .insert(leads)
          .values({
            name: l.name,
            company: l.company,
            phone,
            source: l.source,
            status: l.status,
            lostReason: l.lostReason ?? null,
            followUpDate:
              l.followUpInDays === null ? null : dateInTz(opts.timeZone, l.followUpInDays, now),
            ownerId: l.owner ? actor(l.owner) : null,
            lastActivityAt: latest,
            createdAt: uploadedAt,
            updatedAt: latest,
          })
          .returning({ id: leads.id });
        leadId = (row as { id: string }).id;
      }

      const hasHistory =
        (
          await tx
            .select({ id: activities.id })
            .from(activities)
            .where(eq(activities.leadId, leadId))
            .limit(1)
        ).length > 0;
      if (hasHistory) continue;
      await tx.insert(activities).values([
        {
          leadId,
          actorId: actor("a"),
          type: "UPLOADED" as const,
          text: "Uploaded by Admin",
          createdAt: new Date(now.getTime() - 72 * HOUR),
        },
        ...l.acts.map(([h, who, type, text]) => ({
          leadId: leadId as string,
          actorId: actor(who),
          type,
          text,
          createdAt: new Date(now.getTime() - h * HOUR),
        })),
      ]);
    }

    for (const [key, value] of [
      ["staleDays", 2],
      ["reminderEnabled", true],
      ["reminderTime", "09:00"],
    ] as const) {
      await tx.insert(settings).values({ key, value }).onConflictDoNothing();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to seed demo data in production");
  const url = process.env.DATABASE_URL;
  const password = process.env.SEED_PASSWORD;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!password || password.length < 8) throw new Error("SEED_PASSWORD (min 8 chars) is required");
  const { db, pool } = createDb(url);
  try {
    await seed(db, {
      password,
      defaultCountry: process.env.DEFAULT_COUNTRY_CODE ?? "IN",
      timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    });
    console.warn("seed complete");
  } finally {
    await pool.end();
  }
}
