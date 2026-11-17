# Leadbook

A small lead-management app for a sales team. An **admin** uploads leads, assigns each to one employee, and watches the team's work. **Employees** see only their own leads, call or WhatsApp them, log what happened, move them through the pipeline and set follow-ups. A daily WhatsApp reminder tells each employee which follow-ups are due.

`reference/leadbook-flow-demo.html` is the clickable prototype the screens and wording follow. `docs/TASKS.md` is the task tracker and full build log (decisions, bugs found, known gaps).

## What it does

- **Admin:** overview and team numbers; all leads with search, filters and reassign; CSV upload (duplicates skipped, bad rows reported) with optional automatic assignment; team management (add, deactivate, reactivate); stale-lead and lost-reason reports; activity feed; reminder settings, "Send now" and a sent log.
- **Employee:** My leads and Follow-ups; a lead drawer with Call and WhatsApp links, call outcomes, notes, status, next follow-up and the full history; a panel showing the reminders they were sent.
- Phone, tablet and desktop layouts (checked at 360, 390 and 768 px), light and dark.

### Rules the system enforces (server-side, not just in the UI)

1. One owner per lead; employees see and change only their own leads (another employee's lead is a 404, identical to a missing one).
2. Only the owner works a lead; admins assign and observe but do not log calls.
3. Moving a lead to Lost needs a reason. Won and Lost leads set no follow-up.
4. History is append-only (a database trigger blocks edits and deletes).
5. A call that gets No answer or Busy sets the follow-up to tomorrow; a call on a New lead moves it to Contacted.
6. Deactivating an employee returns their open leads to the unassigned pool, with history, and keeps at least one active employee.
7. A lead is stale after `staleDays` (default 2) days without activity.
8. At most one reminder per employee per day; Won and Lost leads are never in a reminder.

## Stack

Node 22 / TypeScript, Fastify 5, Zod, Drizzle ORM, PostgreSQL 16 · React 19, Vite, Tailwind 4, React Router 7, TanStack Query 5 · Vitest, Testing Library, Playwright · pnpm workspace (`apps/api`, `apps/web`, `e2e`).

## Run it locally

Needs Node 22 (20 is declared but untested), pnpm 10, and PostgreSQL 16 (Docker Compose supplies it).

```bash
pnpm install
cp .env.example .env            # set JWT_SECRET (32+ characters); the other defaults work locally
docker compose up -d            # PostgreSQL on :5432   (no Docker: node scripts/dev-postgres.mjs)
pnpm db:migrate
pnpm db:seed                    # demo data; password = SEED_PASSWORD from .env
pnpm --filter @leadbook/api dev     # API  on http://localhost:3000
pnpm --filter @leadbook/web dev     # web  on http://localhost:5173  (proxies /api to the API)
```

Sign in as `admin@demo.com`, `priya@demo.com`, `rohan@demo.com` or `anita@demo.com` with the seed password. Reminders use the **mock** provider by default: they are recorded in the log and nothing is sent.

## Tests and checks

```bash
export DATABASE_URL=postgresql://leadbook:leadbook@localhost:5432/leadbook   # DB tests are skipped without it
pnpm test            # API (498) and web (71) unit/integration tests; each test builds its own database
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test:e2e        # Playwright with system Chrome: 7 lifecycle specs + 75 mobile checks (needs Postgres on :5432)
```

The API suites include an authorization matrix (every route against anonymous, admin and employee, plus cross-employee access), concurrency tests (double sends, simultaneous deactivation) and error-format checks.

## Configuration

All settings are environment variables, read and validated at start-up (the API refuses to start on a bad value). `.env.example` (development) and `.env.production.example` (Compose) list them.

| Variable                                                                                      | Default                 | Notes                                                                      |
| --------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                | required                | PostgreSQL connection string                                               |
| `JWT_SECRET`                                                                                  | required                | 32+ characters. Changing it signs everyone out                             |
| `JWT_EXPIRES_IN`                                                                              | `8h`                    | Session length                                                             |
| `NODE_ENV`                                                                                    | `development`           | `production` enforces `COOKIE_SECURE=true`                                 |
| `PORT`                                                                                        | `3000`                  | API port                                                                   |
| `COOKIE_SECURE`                                                                               | `false`                 | Must be `true` in production (HTTPS only)                                  |
| `CORS_ORIGIN`                                                                                 | `http://localhost:5173` | Comma-separated allowed browser origins                                    |
| `TRUST_PROXY`                                                                                 | `false`                 | `true` only behind a proxy you control that sets `X-Forwarded-For`         |
| `LOGIN_MAX_FAILURES_PER_ACCOUNT` / `_PER_IP` / `LOGIN_WINDOW_MINUTES`                         | `5` / `20` / `15`       | Failed-login limits (in memory, per instance)                              |
| `DEFAULT_COUNTRY_CODE`                                                                        | `IN`                    | Applied to phone numbers without a country code                            |
| `APP_TIMEZONE`                                                                                | `Asia/Kolkata`          | "Today", overdue and reminder times use this, not the server clock         |
| `WHATSAPP_PROVIDER`                                                                           | `mock`                  | `mock` records only; `meta` sends via the WhatsApp Cloud API               |
| `WHATSAPP_PHONE_NUMBER_ID`, `_ACCESS_TOKEN`, `_TEMPLATE_NAME`, `_APP_SECRET`, `_VERIFY_TOKEN` | required with `meta`    | See `docs/WHATSAPP.md`                                                     |
| `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_API_BASE`                                                 | `en`, Graph API v21.0   | Template language; API base URL                                            |
| `SCHEDULER_ENABLED`                                                                           | `true`                  | The in-process daily reminder job                                          |
| `SEED_PASSWORD`                                                                               | dev only                | Password for the demo users (`pnpm db:seed`; refuses to run in production) |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`                                                 | one-off                 | Only for `create-admin`, the first-admin command (`docs/DEPLOY.md`)        |

Admin-editable settings (stale days, reminders on/off, reminder time) live in the database and are changed in the app.

## Layout

```
apps/api/src    routes/ (HTTP), services/ (rules and queries), db/ (schema, migrations, seed, CLI), whatsapp/, scheduler.ts, test/
apps/api/drizzle  SQL migrations
apps/web/src    pages/{admin,employee}, components/, lib/ (api, auth, queries, theme)
e2e/            Playwright specs and config
deploy/         Dockerfiles and nginx template      scripts/  backup.sh, restore.sh, dev-postgres.mjs
docs/           TASKS.md (tracker and log), DEPLOY.md, BACKUP.md, WHATSAPP.md
```

## Going to production

Read `docs/DEPLOY.md` (one public HTTPS address, one API instance, migrations, first admin, updating), `docs/BACKUP.md` (nightly dump, off-host copy, restore drill) and `docs/WHATSAPP.md` (template, webhook, go-live checklist).

## Known limitations

Not verified: `docker build` / `docker compose up` (no Docker daemon was available while building), the live WhatsApp Cloud API (no credentials; tested against a local simulation), Node 20, and a 5,000-row CSV upload. Design limits: no password-reset flow (an admin can deactivate and re-add someone); a session cannot be revoked before it expires (signing out clears the cookie only); login rate limits are in memory; web and API must share one site (the Compose setup does this); a scheduled reminder is skipped for the day if the server is down all day; the reason a WhatsApp send failed is only in server logs. The full list, with the reasoning, is at the end of `docs/TASKS.md`.
