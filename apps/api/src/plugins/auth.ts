import { eq } from "drizzle-orm";
import fp from "fastify-plugin";
import { users, type User } from "../db/schema.js";
import { AppError, forbidden, unauthorized } from "../errors.js";
import { SESSION_COOKIE, verifySession } from "../lib/tokens.js";

export type SessionUser = Pick<
  User,
  "id" | "name" | "email" | "role" | "phone" | "isActive" | "mustChangePassword"
>;

declare module "fastify" {
  interface FastifyContextConfig {
    /** Route stays reachable while the user still has a temporary password (me, change-password). */
    allowTempPassword?: boolean;
  }
  interface FastifyRequest {
    user?: SessionUser;
  }
  interface FastifyInstance {
    /** preHandler: requires a valid session for an active user. */
    authenticate: (req: import("fastify").FastifyRequest) => Promise<void>;
    /**
     * preHandler factory: valid session for an active user, and (if roles are given) one of those roles.
     * 401 when not signed in, 403 when signed in with the wrong role. The role is read from the
     * database on every request, never from the token.
     */
    guard: (
      ...roles: SessionUser["role"][]
    ) => (req: import("fastify").FastifyRequest) => Promise<void>;
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

  app.decorate("guard", (...roles) => async (req) => {
    await app.authenticate(req);
    const user = req.user as SessionUser;
    // A user on a temporary password can do nothing but change it (enforced here, not only in the UI).
    if (user.mustChangePassword && !req.routeOptions.config.allowTempPassword)
      throw new AppError(
        403,
        "PASSWORD_CHANGE_REQUIRED",
        "You must change your temporary password first",
      );
    if (roles.length > 0 && !roles.includes(user.role)) throw forbidden();
  });
});
