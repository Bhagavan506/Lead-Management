/**
 * One-off command for a new deployment: creates the first admin from ADMIN_NAME, ADMIN_EMAIL and
 * ADMIN_PASSWORD. Run it once after the migrations. See docs/DEPLOY.md.
 */
import { createFirstAdmin, BootstrapError } from "../services/admin-bootstrap.js";
import { createDb } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, pool } = createDb(url);
try {
  const admin = await createFirstAdmin(db, {
    name: process.env.ADMIN_NAME ?? "",
    email: process.env.ADMIN_EMAIL ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
  });
  console.warn(`admin created: ${admin.email} (must change the password at first sign-in)`);
} catch (e) {
  if (e instanceof BootstrapError) {
    console.error(e.message);
    process.exitCode = 1;
  } else throw e;
} finally {
  await pool.end();
}
