import { eq } from "drizzle-orm";
import fp from "fastify-plugin";
import { users, type User } from "../db/schema.js";
import { unauthorized } from "../errors.js";
import { SESSION_COOKIE, verifySession } from "../lib/tokens.js";

export type SessionUser = Pick<
  User,
  "id" | "name" | "email" | "role" | "phone" | "isActive" | "mustChangePassword"
>;

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
  interface FastifyInstance {
    /** preHandler: requires a valid session for an active user. */
    authenticate: (req: import("fastify").FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorate("authenticate", async (req) => {
    const id = await verifySession(req.cookies[SESSION_COOKIE], app.config.JWT_SECRET);
    if (!id) throw unauthorized();
    // Always reload: deactivation and role changes take effect immediately.
    const [row] = await app.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        phone: users.phone,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.id, id));
    if (!row || !row.isActive) throw unauthorized();
    req.user = row;
  });
});
