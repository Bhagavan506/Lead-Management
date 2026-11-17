import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { normalizePhone } from "../lib/phone.js";
import type { SessionUser } from "../plugins/auth.js";
import {
  createEmployee,
  deactivateEmployee,
  listUsers,
  reactivateEmployee,
} from "../services/users.js";

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(1).max(40),
});
const idParams = z.object({ id: z.string().uuid() });

export async function userRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.guard("ADMIN") };

  app.get("/", admin, async () => ({ users: await listUsers(app.db) }));

  app.post("/", admin, async (req, reply) => {
    const body = createBody.parse(req.body);
    const phone = normalizePhone(body.phone, app.config.DEFAULT_COUNTRY_CODE);
    if (!phone)
      throw new AppError(422, "VALIDATION_ERROR", "Invalid request", [
        { path: "phone", message: "Not a valid phone number" },
      ]);
    const { user, temporaryPassword } = await createEmployee(app.db, { ...body, phone });
    // The only time the temporary password is ever returned. Never cached, never logged.
    reply.header("Cache-Control", "no-store");
    return reply.status(201).send({ user, temporaryPassword });
  });

  app.post("/:id/deactivate", admin, async (req) => {
    const { id } = idParams.parse(req.params);
    return deactivateEmployee(app.db, id, (req.user as SessionUser).id);
  });

  app.post("/:id/reactivate", admin, async (req) => {
    const { id } = idParams.parse(req.params);
    return reactivateEmployee(app.db, id);
  });
}
