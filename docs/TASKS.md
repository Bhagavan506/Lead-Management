# Leadbook — Task tracker

Status values: `todo`, `in progress`, `blocked`, `done`.
Rule: one task at a time, in order. A task is `done` only when typecheck, lint and tests pass. One commit per task (`T1.4: auth middleware and role guard`).

| ID                                                                                               | Task                                                                                                                 | Done when                                                                 | Status      | Commit |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- | ------ |
| **Phase 0: Setup**                                                                               |                                                                                                                      |                                                                           |             |        |
| 0.1                                                                                              | Scaffold pnpm monorepo (`apps/api`, `apps/web`, `reference/`), TypeScript config, lint and format, `.env.example`    | `pnpm install`, `pnpm lint` and `pnpm typecheck` pass                     | in progress |        |
| 0.2                                                                                              | Docker Compose for Postgres and Redis; API `/health` endpoint                                                        | `docker compose up` works and `/health` returns 200                       | todo        |        |
| 0.3                                                                                              | Drizzle ORM setup with migration runner; `pnpm test` script in both apps                                             | A trivial test passes in each app                                         | todo        |        |
| **Phase 1: Database and auth**                                                                   |                                                                                                                      |                                                                           |             |        |
| 1.1                                                                                              | Full Drizzle schema and generated migration per the data model; unique index on phone; indexes on ownerId and status | Migration applies cleanly on an empty database                            | todo        |        |
| 1.2                                                                                              | Seed script: 1 admin, 3 employees, 9 sample leads matching the prototype                                             | `pnpm db:seed` is repeatable                                              | todo        |        |
| 1.3                                                                                              | Login, logout, `/auth/me` with argon2 and httpOnly cookie JWT                                                        | Tests cover good login, wrong password, expired token                     | todo        |        |
| 1.4                                                                                              | Auth middleware, role guard, rejection of inactive users                                                             | Tests show an employee gets 403 on admin routes                           | todo        |        |
| 1.5                                                                                              | Login rate limiting, security headers, CORS configuration                                                            | Repeated bad logins return 429                                            | todo        |        |
| **Phase 2: Team management**                                                                     |                                                                                                                      |                                                                           |             |        |
| 2.1                                                                                              | Create and list employees; generate temporary password shown once                                                    | Tests pass and the hash is never returned                                 | todo        |        |
| 2.2                                                                                              | Deactivate and reactivate per rule 7, in one transaction                                                             | Tests cover returning leads to pool and blocking the last active employee | todo        |        |
| 2.3                                                                                              | Force password change on first login                                                                                 | A temp-password user cannot use the app until they change it              | todo        |        |
| **Phase 3: Leads core**                                                                          |                                                                                                                      |                                                                           |             |        |
| 3.1                                                                                              | Phone normalization utility with unit tests                                                                          | Handles spaces, dashes, leading 0, plus prefix, invalid input             | todo        |        |
| 3.2                                                                                              | Lead list with filters, search, pagination, role-scoped in the query layer                                           | An employee test never receives another employee's lead                   | todo        |        |
| 3.3                                                                                              | Lead detail with timeline, owner-scoped (404 for others)                                                             | Tests pass                                                                | todo        |        |
| 3.4                                                                                              | CSV upload with validation, duplicate skipping, result report (added, skipped, invalid rows with reasons)            | Tests cover a duplicate inside the file and one against the database      | todo        |        |
| 3.5                                                                                              | Single assign and reassign (admin), writing activity records                                                         | History shows "Assigned to X"                                             | todo        |        |
| 3.6                                                                                              | Auto-assign to least-loaded active employee in a transaction                                                         | A concurrency test proves one owner per lead                              | todo        |        |
| **Phase 4: Employee work**                                                                       |                                                                                                                      |                                                                           |             |        |
| 4.1                                                                                              | Status change with required lost reason (rule 5)                                                                     | Lost without a reason returns 422                                         | todo        |        |
| 4.2                                                                                              | Call logging with outcomes and follow-up rules (rule 8)                                                              | Tests pass                                                                | todo        |        |
| 4.3                                                                                              | Notes and follow-up date, owner only (rule 4)                                                                        | Admin or another employee gets 403 or 404                                 | todo        |        |
| 4.4                                                                                              | Contact events for call and WhatsApp taps                                                                            | They appear in the timeline                                               | todo        |        |
| **Phase 5: Admin insights** (each: tests against seeded data, admin-only)                        |                                                                                                                      |                                                                           |             |        |
| 5.1                                                                                              | Overview stats: totals, unassigned, won, overdue, stale                                                              | Endpoint tested against seed data, admin-only                             | todo        |        |
| 5.2                                                                                              | Team performance per employee: assigned, not contacted, worked, won, lost, overdue, last activity                    | Endpoint tested against seed data, admin-only                             | todo        |        |
| 5.3                                                                                              | Stale leads and the `staleDays` setting (rule 9)                                                                     | Endpoint tested against seed data, admin-only                             | todo        |        |
| 5.4                                                                                              | Lost reasons breakdown                                                                                               | Endpoint tested against seed data, admin-only                             | todo        |        |
| 5.5                                                                                              | Activity feed, paginated                                                                                             | Endpoint tested against seed data, admin-only                             | todo        |        |
| **Phase 6: Frontend foundation**                                                                 |                                                                                                                      |                                                                           |             |        |
| 6.1                                                                                              | Vite, React, Tailwind, router, API client, TanStack Query                                                            | App builds and calls `/health`                                            | todo        |        |
| 6.2                                                                                              | Login page, auth context, role-based protected routes                                                                | Employee typing an admin URL is redirected                                | todo        |        |
| 6.3                                                                                              | Responsive app shell: header, scrollable tabs on mobile, light and dark mode                                         | Looks right at 360 and 768 px                                             | todo        |        |
| **Phase 7: Admin screens** (each: loading, empty, error states; passes 360 px check)             |                                                                                                                      |                                                                           |             |        |
| 7.1                                                                                              | Overview: flow strip, stats, team table, stale and lost-reason panels                                                | States present; 360 px check passes                                       | todo        |        |
| 7.2                                                                                              | All leads: filters, reassign dropdown, desktop table, mobile compact list                                            | States present; 360 px check passes                                       | todo        |        |
| 7.3                                                                                              | Read-only lead drawer with full history                                                                              | States present; 360 px check passes                                       | todo        |        |
| 7.4                                                                                              | Upload leads: file or paste, assignment mode, result report                                                          | States present; 360 px check passes                                       | todo        |        |
| 7.5                                                                                              | Team: add, deactivate, reactivate, auto-assign pool                                                                  | States present; 360 px check passes                                       | todo        |        |
| 7.6                                                                                              | Activity feed                                                                                                        | States present; 360 px check passes                                       | todo        |        |
| **Phase 8: Employee screens** (employee cannot see or open another employee's lead, even by URL) |                                                                                                                      |                                                                           |             |        |
| 8.1                                                                                              | My leads: cards, follow-ups due first, stale tags                                                                    | Cross-employee access blocked, even by URL                                | todo        |        |
| 8.2                                                                                              | Lead drawer: status, follow-up date, call outcomes, notes, call and WhatsApp buttons, lost-reason dialog             | Cross-employee access blocked, even by URL                                | todo        |        |
| 8.3                                                                                              | Follow-ups tab and reminder panel                                                                                    | Cross-employee access blocked, even by URL                                | todo        |        |
| **Phase 9: WhatsApp reminders**                                                                  |                                                                                                                      |                                                                           |             |        |
| 9.1                                                                                              | Provider interface with `MockProvider` writing to `ReminderLog`, selected by env var                                 | Tests run with the mock only                                              | todo        |        |
| 9.2                                                                                              | Reminder job: one message per employee with due/overdue follow-ups, idempotent per employee per day (rule 10)        | Running the job twice sends once                                          | todo        |        |
| 9.3                                                                                              | Admin reminder settings (on/off, send time), "Send now", sent log, employee reminder panel                           | Tests pass                                                                | todo        |        |
| 9.4                                                                                              | Meta WhatsApp Cloud API provider with approved template; delivery-status webhook with signature verification         | **Blocked until credentials and template name are provided**              | blocked     |        |
| **Phase 10: Hardening and release**                                                              |                                                                                                                      |                                                                           |             |        |
| 10.1                                                                                             | Playwright E2E: admin uploads, assigns, employee works a lead, admin sees activity                                   | E2E suite passes                                                          | todo        |        |
| 10.2                                                                                             | Authorization test matrix: employee vs every admin route; employee A vs employee B's lead (IDOR)                     | Matrix passes                                                             | todo        |        |
| 10.3                                                                                             | Input validation and error-format review, request logging, dependency audit                                          | Review done, audit clean or documented                                    | todo        |        |
| 10.4                                                                                             | Mobile QA pass on every screen at 360, 390, 768 px, with fixes                                                       | All screens checked and fixed                                             | todo        |        |
| 10.5                                                                                             | Production Dockerfiles, deployment notes, database backup plan (**ask about hosting first**)                         | Images build; notes and backup plan written                               | todo        |        |
| 10.6                                                                                             | README, environment variable docs, final Progress log with known gaps                                                | Docs complete                                                             | todo        |        |

## Progress log

### Planning — 2026-11-17

- Created this tracker from the implementation prompt. No code written.
- `reference/leadbook-flow-demo.html` is **not yet in the repo** — required before Task 1.2 (seed data "matching the prototype") and Phase 7–8 (screens and wording).
- Open questions raised with the owner before Task 0.1 (see planning reply): seed vs phone-normalization ordering, missing `mustChangePassword` field, stale-lead definition, reminder timezone and retry semantics, upload assignment mode, Redis necessity, 403 vs 404 for admins on lead work.
- Waiting for "go".

### Prototype review — 2026-11-17

Prototype added at `reference/leadbook-flow-demo.html`. Resolved by it (treated as spec):

- **Upload assignment modes:** keep in pool / split evenly (least-loaded) / assign all to one employee. `POST /leads/upload` gets a `mode` field (affects 3.4).
- **Status changes:** any status → any status. Leaving Lost clears the reason. Won and Lost clear the follow-up. "Other" lost reason has no free text.
- **Call on New lead** writes two activities ("Call: X", "Status: New → Contacted"); No answer/Busy also writes "Follow-up set to DATE".
- **Stale** = open lead whose newest activity of _any_ kind (incl. admin upload/assign, contact taps) is older than `staleDays`.
- **Activity wording** to copy verbatim: "Uploaded by Admin", "Assigned to X", "Moved back to unassigned pool", "Status: A → B", "Status: A → Lost (Reason)", "Call: Outcome", "Follow-up set to DATE|none", "Note: text", "Call started from app", "WhatsApp chat opened".
- **Team table:** Assigned = all owned; Not yet contacted = New; Worked = not New; Last activity = latest by that employee.
- **Reminder message format** and send-time options (08:00 / 09:00 / 10:00); per-employee "Send now" plus "Send all due now".
- **Seed:** Admin + Priya Sharma, Rohan Verma, Anita Das (+91 numbers); 9 leads, 3 unassigned; follow-up dates relative to today → `DEFAULT_COUNTRY_CODE=IN`.
- Prototype-only, not carried over: "Reset demo", quick-fill demo logins, auto-generated `@demo.com` emails, shared password `1234`.

Still open (asked of owner): manual "Send now" vs one-per-day uniqueness; multi-line message vs Meta template limits; employee email entry; schema additions in 1.1; Redis; `APP_TIMEZONE`.

### Go given — 2026-11-17

Owner said "go" without answering the open questions, so defaults apply:

- Schema (1.1) adds `User.mustChangePassword`, `Activity.meta` (JSON), `Lead.lastActivityAt`.
- **Execution order change:** 3.1 (phone normalizer) is done right after 1.1 and before 1.2 (seed needs E.164).
- `APP_TIMEZONE=Asia/Kolkata`, `DEFAULT_COUNTRY_CODE=IN`, both env vars.
- No Redis/BullMQ: in-process per-minute scheduler, unique(employeeId, date) for idempotency; in-memory rate limit. Docker Compose gets Postgres only. Revisit if hosting needs multiple API instances.
- "Send now": scheduled run once per employee per day; manual send is a separate logged override.
- Reminder text must fit a Meta template (no line breaks in variables, no customer phone numbers).
- Add Email field to Add employee form; show deactivated owners greyed out in the owner dropdown.
- Node on this machine is v22 (prompt says 20); `engines` allows >=20.

### T0.2 note

\* `/health` returns 200 (verified by running the API and curl). `docker compose config` validates the Compose file, but **`docker compose up` itself was not run**: the build sandbox has no Docker daemon. Owner: please run `docker compose up -d` once on your machine. Compose has Postgres only (Redis dropped, see decisions above).

### T0.3 rework — ORM switched from Prisma to Drizzle (owner decision)

- Prisma's CLI needs engine binaries from `binaries.prisma.sh`, blocked by the sandbox network policy (403). Both `prisma generate` and `prisma migrate` need it, so nothing downstream (schema, migration, tests) could be verified. Also: `pnpm add prisma` resolves to the 8.0 release candidate, which dropped `generate`/`migrate`.
- Owner chose to switch ORM. Picked **Drizzle** over Kysely: schema in TypeScript, migrations generated by `drizzle-kit generate`, `SELECT … FOR UPDATE` support for the concurrency rules (1, 7, auto-assign).
- Pinned stable `drizzle-orm@0.45.4` and `drizzle-kit@0.31.11` (1.0 is still beta/RC).
- Layout: `apps/api/src/db/{schema,client,migrate}.ts`, migrations in `apps/api/drizzle/`, scripts `db:generate` and `db:migrate`.
- Tests: the DB test runs only when `DATABASE_URL` is set (skipped otherwise). Verified here against the embedded Postgres.
- Still unverified: `docker compose up` (no Docker daemon in this sandbox).
- Wherever this tracker or the owner's prompt says "Prisma", read "Drizzle".

### T1.1 note

Schema in `apps/api/src/db/schema.ts`; migrations `0000_init_schema` (generated) and `0001_activities_append_only` (custom trigger). Beyond the prompt's model (all agreed in the planning decisions): `users.must_change_password`, `activities.meta`, `leads.last_activity_at`, `reminder_log.kind` with a _partial_ unique index so only SCHEDULED rows are limited to one per employee per day. Enforced in the database, not just code: E.164 phone check, lost-reason-iff-LOST check, case-insensitive unique email, append-only activities (UPDATE/DELETE/TRUNCATE blocked by trigger). 10 tests run against a fresh database per run (`src/test/db.ts`).

### T3.1 note (executed out of order, before 1.2, by agreement)

`normalizePhone(input, defaultCountry)` in `apps/api/src/lib/phone.ts`, built on `libphonenumber-js` (full metadata, strict `isValid()`). Returns E.164 or null. Default country is a parameter fed from `DEFAULT_COUNTRY_CODE`. Covers spaces, dashes, dots, brackets, leading 0, `+` prefix, `00` prefix, other countries with explicit prefix, junk and non-strings. Note: strict validity means numbers that merely look plausible (e.g. wrong length or unassigned ranges) are rejected as invalid on upload.

### T1.2 note

`pnpm db:seed` (root) → `apps/api/src/db/seed.ts`. Admin `admin@demo.com` + Priya, Rohan, Anita (`@demo.com`), 9 leads and 20 history entries mirroring the prototype (follow-up dates relative to today in `APP_TIMEZONE`). Password comes from `SEED_PASSWORD` (not hardcoded; prototype's `admin123`/`1234` deliberately not used). Refuses to run when `NODE_ENV=production`. Idempotent: users by email, leads by phone, history only written when a lead has none. Prototype's note text "Wants pricing for 20 seats" is stored as "Note: …" to match how notes are written.

### T1.3 note

Routes: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. HS256 JWT (`jose`) in cookie `lb_session`: HttpOnly, SameSite=Strict, Path=/, Secure per `COOKIE_SECURE` (config refuses `COOKIE_SECURE=false` or the example secret when `NODE_ENV=production`). Login returns one generic 401 for unknown email, wrong password and deactivated account, and always runs an argon2 verify (dummy hash for unknown emails) so timing does not reveal accounts. The user is reloaded from the DB on every request, so deactivation takes effect immediately. Validation errors return **422**; all errors share `{ error: { code, message, details? } }`. 18 auth tests, incl. expired token, wrong-secret token, tampered token, `alg=none`, deactivated mid-session. Verified against the real server with curl.

- **Known gap (stateless JWT):** logout clears the cookie in the browser but cannot revoke a token that was already copied; it stays valid until it expires (default 8h). Fixing it needs a token-version column (data-model change), so deferred; say if you want it.
- **Bug found and fixed during the real-server check:** `.env` was only read from `apps/api`; now loaded from the repo root regardless of cwd.
- `SameSite=Strict` means the web app and API must be same-site (same registrable domain) in production. Revisit when hosting is chosen (10.5).

### T1.4 note

`app.guard(...roles)` preHandler factory in `plugins/auth.ts`: 401 when not signed in, 403 for the wrong role, no roles = any signed-in user. Role and active flag are read from the DB on every request (a demoted or deactivated user is affected immediately; tested). Admin-only routes will use `app.guard("ADMIN")`, employee work routes `app.guard("EMPLOYEE")` (so admins are read-only on lead work, rule 4). Tested with throwaway probe routes since the real admin routes arrive in Phase 2. 7 tests.

### T1.5 note

- **Login limiter** (`lib/failure-limiter.ts`, in-memory sliding window, counts _failures only_): 5 failures per IP+email and 20 per IP, per 15 min (env-configurable). Blocked clients get 429 + `Retry-After`, checked before any password hashing, and a correct password is also refused while blocked. Success resets the account counter; 422 validation errors are not counted.
- `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, otherwise a client could dodge the limit by rotating the header. **Must be set to true behind a reverse proxy**, or every user shares the proxy's IP and one attacker can lock everyone out via the per-IP cap.
- `@fastify/helmet` default headers; `@fastify/cors` allows only the origins in `CORS_ORIGIN` (comma list), with credentials.
- Verified by mutation: removing the failure recording makes 4 tests fail.
- **Limit:** counters are per API process and reset on restart. Fine for one instance; with several instances the effective limit multiplies (a shared store would be needed).

### T2.1 note

`GET /api/users` and `POST /api/users` (admin only). Create takes name, email, phone (normalized to E.164 with `DEFAULT_COUNTRY_CODE`; invalid → 422), always creates role EMPLOYEE (a `role` field in the body is ignored), duplicate email (any case) → 409 `EMAIL_TAKEN`. Temporary password: 14 chars from a no-lookalike alphabet via `crypto.randomInt`, returned once with `Cache-Control: no-store`, stored only as an argon2 hash, account flagged `mustChangePassword`. List returns `openLeads` per user and never any hash. **Delivery of the password to the employee is manual** (admin reads it off the screen), since nothing in the spec covers email or SMS. 9 tests.

### T2.2 note

`POST /api/users/:id/deactivate` and `/reactivate` (admin only, employees only). Deactivation runs in one transaction: locks all active employee rows (`FOR UPDATE`) so the last-employee check is race-free, returns only open leads (not Won/Lost) to the pool with one "Moved back to unassigned pool" activity each (actor = admin, `meta.fromOwnerId`), keeps closed leads with their owner, then switches the account off (login and live sessions stop at once). Both calls are idempotent. Reactivation does **not** hand leads back (matches prototype: use Auto-assign). Errors: 409 `LAST_ACTIVE_EMPLOYEE`, 409 `NOT_AN_EMPLOYEE`, 404, 422 for a malformed id. Verified by mutation: without the lock the concurrency test fails 3/3 runs. A forced mid-transaction failure (DB trigger) proves full rollback. 9 tests.

- Returned leads get `lastActivityAt = now`, so a returned lead is not "stale" the moment it re-enters the pool (same as the prototype, where any history entry counts).

## Phase 1 summary (Database and auth) — complete

**Done:** schema + migrations with DB-level rules, seed, login/logout/me, role guard, rate limiting/headers/CORS. 78 tests, all run against a real Postgres (fresh database per suite).
**Untested here:** `docker compose up`; Node 20 (sandbox runs 22); more than one API instance.
**Known gaps:** (1) logout cannot revoke an already-copied JWT until it expires (needs a token-version column; owner has not asked for it); (2) rate-limit counters are in memory; (3) no password-reset flow exists and none is specified; (4) `SameSite=Strict` requires web and API on the same site.

## Status at last checkpoint

Done: Phase 0, Phase 1 (1.1–1.5), 3.1. Next: 2.1 (create/list employees). \*`docker compose up` unverified (no Docker daemon in sandbox).
