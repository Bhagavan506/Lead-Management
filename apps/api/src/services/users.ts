import argon2 from "argon2";
import { and, asc, count, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { leads, users } from "../db/schema.js";
import { AppError } from "../errors.js";
import { generateTempPassword } from "../lib/password.js";

const CLOSED = ["WON", "LOST"] as const;

const publicColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  phone: users.phone,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
};

export async function listUsers(db: Db) {
  const rows = await db
    .select(publicColumns)
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.name));
  const open = await db
    .select({ ownerId: leads.ownerId, n: count() })
    .from(leads)
    .where(and(notInArray(leads.status, [...CLOSED]), sql`${leads.ownerId} is not null`))
    .groupBy(leads.ownerId);
  const byOwner = new Map(open.map((o) => [o.ownerId, o.n]));
  return rows.map((u) => ({ ...u, openLeads: byOwner.get(u.id) ?? 0 }));
}

export async function createEmployee(
  db: Db,
  input: { name: string; email: string; phone: string },
) {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await argon2.hash(temporaryPassword);
  try {
    const [row] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone,
        role: "EMPLOYEE",
        passwordHash,
        mustChangePassword: true,
      })
      .returning(publicColumns);
    return { user: { ...(row as object), openLeads: 0 }, temporaryPassword };
  } catch (e) {
    // 23505 = unique_violation (users_email_lower_key)
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505")
      throw new AppError(409, "EMAIL_TAKEN", "A user with this email already exists");
    throw e;
  }
}
