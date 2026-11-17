import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

export const MIN_ADMIN_PASSWORD = 12;

export class BootstrapError extends Error {}

/**
 * Creates the first administrator of a fresh deployment (the demo seed never runs in production).
 * Refuses when an admin already exists, so it cannot be used to add admins later. The password is
 * temporary: the admin must change it at first sign-in.
 */
export async function createFirstAdmin(
  db: Db,
  input: { name: string; email: string; password: string },
) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new BootstrapError("ADMIN_NAME is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BootstrapError("ADMIN_EMAIL is not a valid email address");
  if (input.password.length < MIN_ADMIN_PASSWORD)
    throw new BootstrapError(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD} characters`);

  const passwordHash = await argon2.hash(input.password);
  return db.transaction(async (tx) => {
    // Serialise concurrent runs so two cannot both see "no admin yet".
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('bootstrap-admin', 0))`);
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "ADMIN"))
      .limit(1);
    if (existing.length > 0)
      throw new BootstrapError("An admin already exists; nothing was changed");
    const [row] = await tx
      .insert(users)
      .values({ name, email, role: "ADMIN", passwordHash, mustChangePassword: true })
      .returning({ id: users.id, email: users.email });
    return row as { id: string; email: string };
  });
}
