# Deploying Leadbook

> **Simplest path (personal use):** one EC2 server with pm2, Caddy and a Neon database, no Docker. See [AWS.md](AWS.md). The rest of this page covers the container setup.

Host-neutral: anything that runs containers (a VM with Docker Compose, a container service, Kubernetes) works. Nothing here depends on one provider.

> **Verification status.** The sandbox this was built in has no Docker daemon, so **`docker build` and `docker compose up` have never been run**. What _was_ checked: the compiled API starts under `node dist/index.js`, migrates a fresh database, creates the first admin and signs in; the `pnpm deploy --legacy` bundle used by the image contains production dependencies only and runs (argon2 included); `docker compose config` validates and enforces required variables; the backup and restore scripts work against a real PostgreSQL 16. Do a first build on a staging host before relying on it.

## Shape of the system

```
browser --HTTPS--> [your TLS / load balancer] --> web (nginx) --+--> static app
                                                                 +--> /api, /health, /webhooks --> api (Node) --> PostgreSQL
```

- **One public address.** The `web` container serves the app and forwards `/api`, `/health` and `/webhooks` to the API, so the browser sees a single origin. This is required: the session cookie is `SameSite=Strict`, `HttpOnly` and `Secure`, so the app and the API must be the **same site**. If you put them on different hosts, they must share a registrable domain (e.g. `app.example.com` and `api.example.com`) and you must revisit CORS and the proxy; the supplied setup avoids the problem.
- **HTTPS is mandatory.** The API refuses to start in production unless `COOKIE_SECURE=true`, and browsers will not send a Secure cookie over plain HTTP. Terminate TLS in front of `web`.
- **Run exactly one API instance.** The reminder scheduler runs inside the API process. A database constraint stops duplicate reminders even if two instances run, but rate limits are in memory and per instance, so scale-out weakens them. One instance is ample for this workload.
- Time-based behaviour (follow-ups due, reminders) uses `APP_TIMEZONE`, not the server clock.

## First deployment

1. Copy `.env.production.example` to `.env.production` and fill it in. Generate secrets with `openssl rand -hex 24` (database password; keep it URL-safe because it is embedded in a connection string) and `openssl rand -base64 48` (`JWT_SECRET`). `PUBLIC_URL` is the https address users type, with no trailing slash.
2. Build and start: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
3. Apply migrations: `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api node dist/db/migrate.js`
4. Create the first admin (once; refuses if an admin exists):
   `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -e ADMIN_NAME="Your Name" -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='a-long-temporary-password' api node dist/db/create-admin.js`
   The password must be at least 12 characters and is temporary: you are made to change it at first sign-in.
5. Open the public address, sign in, and add employees on the Team tab. **Do not run the demo seed in production** (it refuses to).
6. Check `https://<your-address>/health` returns `{"status":"ok"}`, then set up the [backup](BACKUP.md) before real data goes in.

Without Compose, the same three commands apply to the two images (`deploy/api.Dockerfile`, `deploy/web.Dockerfile`); give the API the variables listed in `docker-compose.prod.yml` and set the web container's `API_UPSTREAM` to the API's internal URL. Outside Docker: `pnpm --filter @leadbook/api build`, then `node dist/db/migrate.js` and `node dist/index.js` with the same environment variables.

## Configuration

See the table in the README. Production-specific rules enforced at start-up: `COOKIE_SECURE` must be `true`; `JWT_SECRET` must be at least 32 characters; with `WHATSAPP_PROVIDER=meta` the five WhatsApp credentials must be present. `TRUST_PROXY=true` is set because the web container is the edge and overwrites `X-Forwarded-For` with the real client address; if you put another proxy in front, make sure it does not let clients supply that header, or login rate limiting can be dodged.

## Updating

1. Take a backup (`scripts/backup.sh`).
2. Pull the new code, rebuild: `docker compose ... up -d --build`.
3. Run the migrations command above. Migrations only move forward and are applied in order; running it again is a no-op.
4. Check `/health` and sign in.

**Rollback:** redeploy the previous image. If the new release ran a migration, restore the pre-update backup into a fresh database instead (migrations have no automatic "down"); recent changes made after the backup are lost.

## WhatsApp

Start with `WHATSAPP_PROVIDER=mock` (reminders are recorded in the log, nothing is sent). To go live follow [WHATSAPP.md](WHATSAPP.md); the webhook URL is `https://<your-address>/webhooks/whatsapp`. The Meta integration has **not been verified against the live API**.

## Operations

- **Logs:** JSON lines on stdout (`docker compose logs api`). Cookies and authorization headers are redacted and query strings are not logged. A failed WhatsApp send's reason is only in the logs.
- **Health:** `GET /health` (also the container health check).
- **Secrets:** keep `.env.production` out of version control and store a copy in a password manager. Changing `JWT_SECRET` signs everyone out; it does not lose data.
- **Sessions** last `JWT_EXPIRES_IN` (default 8 h). There is no server-side revocation: signing out clears the cookie but a stolen token stays valid until it expires. Deactivating a user does block them immediately.
