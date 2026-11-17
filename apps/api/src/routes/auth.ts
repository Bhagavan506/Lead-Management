import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "../db/schema.js";
import { unauthorized } from "../errors.js";
import { SESSION_COOKIE, durationToSeconds, signSession } from "../lib/tokens.js";
import type { SessionUser } from "../plugins/auth.js";

const loginBody = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

export const publicUser = (u: SessionUser) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone,
  mustChangePassword: u.mustChangePassword,
});

// Verified against when the email is unknown, so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argon2.hash("not-a-real-password"));

export async function authRoutes(app: FastifyInstance) {
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: app.config.COOKIE_SECURE,
    sameSite: "strict" as const,
  };

  app.post("/login", async (req, reply) => {
    const { email, password } = loginBody.parse(req.body);
    const [row] = await app.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.toLowerCase()));

    const ok = await argon2.verify(row?.passwordHash ?? (await getDummyHash()), password);
    // Same response for unknown email, wrong password and deactivated account.
    if (!row || !ok || !row.isActive) throw unauthorized("Invalid email or password");

    const token = await signSession(row.id, app.config.JWT_SECRET, app.config.JWT_EXPIRES_IN);
    reply.setCookie(SESSION_COOKIE, token, {
      ...cookieOptions,
      maxAge: durationToSeconds(app.config.JWT_EXPIRES_IN),
    });
    return { user: publicUser(row) };
  });

  app.post("/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get("/me", { preHandler: app.authenticate }, async (req) => ({
    user: publicUser(req.user as SessionUser),
  }));
}
