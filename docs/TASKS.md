# Leadbook — Task tracker

Status values: `todo`, `in progress`, `blocked`, `done`.
Rule: one task at a time, in order. A task is `done` only when typecheck, lint and tests pass. One commit per task (`T1.4: auth middleware and role guard`).

| ID                                                                                               | Task                                                                                                                 | Done when                                                                       | Status           | Commit  |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------- | ------- |
| **Phase 0: Setup**                                                                               |                                                                                                                      |                                                                                 |                  |         |
| 0.1                                                                                              | Scaffold pnpm monorepo (`apps/api`, `apps/web`, `reference/`), TypeScript config, lint and format, `.env.example`    | `pnpm install`, `pnpm lint` and `pnpm typecheck` pass                           | in progress      |         |
| 0.2                                                                                              | Docker Compose for Postgres and Redis; API `/health` endpoint                                                        | `docker compose up` works and `/health` returns 200                             | todo             |         |
| 0.3                                                                                              | Drizzle ORM setup with migration runner; `pnpm test` script in both apps                                             | A trivial test passes in each app                                               | todo             |         |
| **Phase 1: Database and auth**                                                                   |                                                                                                                      |                                                                                 |                  |         |
| 1.1                                                                                              | Full Drizzle schema and generated migration per the data model; unique index on phone; indexes on ownerId and status | Migration applies cleanly on an empty database                                  | todo             |         |
| 1.2                                                                                              | Seed script: 1 admin, 3 employees, 9 sample leads matching the prototype                                             | `pnpm db:seed` is repeatable                                                    | todo             |         |
| 1.3                                                                                              | Login, logout, `/auth/me` with argon2 and httpOnly cookie JWT                                                        | Tests cover good login, wrong password, expired token                           | todo             |         |
| 1.4                                                                                              | Auth middleware, role guard, rejection of inactive users                                                             | Tests show an employee gets 403 on admin routes                                 | todo             |         |
| 1.5                                                                                              | Login rate limiting, security headers, CORS configuration                                                            | Repeated bad logins return 429                                                  | todo             |         |
| **Phase 2: Team management**                                                                     |                                                                                                                      |                                                                                 |                  |         |
| 2.1                                                                                              | Create and list employees; generate temporary password shown once                                                    | Tests pass and the hash is never returned                                       | todo             |         |
| 2.2                                                                                              | Deactivate and reactivate per rule 7, in one transaction                                                             | Tests cover returning leads to pool and blocking the last active employee       | todo             |         |
| 2.3                                                                                              | Force password change on first login                                                                                 | A temp-password user cannot use the app until they change it                    | todo             |         |
| **Phase 3: Leads core**                                                                          |                                                                                                                      |                                                                                 |                  |         |
| 3.1                                                                                              | Phone normalization utility with unit tests                                                                          | Handles spaces, dashes, leading 0, plus prefix, invalid input                   | todo             |         |
| 3.2                                                                                              | Lead list with filters, search, pagination, role-scoped in the query layer                                           | An employee test never receives another employee's lead                         | todo             |         |
| 3.3                                                                                              | Lead detail with timeline, owner-scoped (404 for others)                                                             | Tests pass                                                                      | todo             |         |
| 3.4                                                                                              | CSV upload with validation, duplicate skipping, result report (added, skipped, invalid rows with reasons)            | Tests cover a duplicate inside the file and one against the database            | todo             |         |
| 3.5                                                                                              | Single assign and reassign (admin), writing activity records                                                         | History shows "Assigned to X"                                                   | todo             |         |
| 3.6                                                                                              | Auto-assign to least-loaded active employee in a transaction                                                         | A concurrency test proves one owner per lead                                    | done             | dd61ef0 |
| **Phase 4: Employee work**                                                                       |                                                                                                                      |                                                                                 |                  |         |
| 4.1                                                                                              | Status change with required lost reason (rule 5)                                                                     | Lost without a reason returns 422                                               | done             | 31c9474 |
| 4.2                                                                                              | Call logging with outcomes and follow-up rules (rule 8)                                                              | Tests pass                                                                      | done             | 22af2cc |
| 4.3                                                                                              | Notes and follow-up date, owner only (rule 4)                                                                        | Admin or another employee gets 403 or 404                                       | done             | 22af2cc |
| 4.4                                                                                              | Contact events for call and WhatsApp taps                                                                            | They appear in the timeline                                                     | done             | 22af2cc |
| **Phase 5: Admin insights** (each: tests against seeded data, admin-only)                        |                                                                                                                      |                                                                                 |                  |         |
| 5.1                                                                                              | Overview stats: totals, unassigned, won, overdue, stale                                                              | Endpoint tested against seed data, admin-only                                   | done             |         |
| 5.2                                                                                              | Team performance per employee: assigned, not contacted, worked, won, lost, overdue, last activity                    | Endpoint tested against seed data, admin-only                                   | done             |         |
| 5.3                                                                                              | Stale leads and the `staleDays` setting (rule 9)                                                                     | Endpoint tested against seed data, admin-only                                   | done             |         |
| 5.4                                                                                              | Lost reasons breakdown                                                                                               | Endpoint tested against seed data, admin-only                                   | done             |         |
| 5.5                                                                                              | Activity feed, paginated                                                                                             | Endpoint tested against seed data, admin-only                                   | done             |         |
| **Phase 6: Frontend foundation**                                                                 |                                                                                                                      |                                                                                 |                  |         |
| 6.1                                                                                              | Vite, React, Tailwind, router, API client, TanStack Query                                                            | App builds and calls `/health`                                                  | done             | 219aed9 |
| 6.2                                                                                              | Login page, auth context, role-based protected routes                                                                | Employee typing an admin URL is redirected                                      | done             | 219aed9 |
| 6.3                                                                                              | Responsive app shell: header, scrollable tabs on mobile, light and dark mode                                         | Looks right at 360 and 768 px                                                   | done             | 219aed9 |
| **Phase 7: Admin screens** (each: loading, empty, error states; passes 360 px check)             |                                                                                                                      |                                                                                 |                  |         |
| 7.1                                                                                              | Overview: flow strip, stats, team table, stale and lost-reason panels                                                | States present; 360 px check passes                                             | done             | df6ed96 |
| 7.2                                                                                              | All leads: filters, reassign dropdown, desktop table, mobile compact list                                            | States present; 360 px check passes                                             | done             | df6ed96 |
| 7.3                                                                                              | Read-only lead drawer with full history                                                                              | States present; 360 px check passes                                             | done             | df6ed96 |
| 7.4                                                                                              | Upload leads: file or paste, assignment mode, result report                                                          | States present; 360 px check passes                                             | done             | df6ed96 |
| 7.5                                                                                              | Team: add, deactivate, reactivate, auto-assign pool                                                                  | States present; 360 px check passes                                             | done             | df6ed96 |
| 7.6                                                                                              | Activity feed                                                                                                        | States present; 360 px check passes                                             | done             | df6ed96 |
| **Phase 8: Employee screens** (employee cannot see or open another employee's lead, even by URL) |                                                                                                                      |                                                                                 |                  |         |
| 8.1                                                                                              | My leads: cards, follow-ups due first, stale tags                                                                    | Cross-employee access blocked, even by URL                                      | done             | 200950b |
| 8.2                                                                                              | Lead drawer: status, follow-up date, call outcomes, notes, call and WhatsApp buttons, lost-reason dialog             | Cross-employee access blocked, even by URL                                      | done             | 200950b |
| 8.3                                                                                              | Follow-ups tab and reminder panel                                                                                    | Cross-employee access blocked, even by URL                                      | done             |         |
| **Phase 9: WhatsApp reminders**                                                                  |                                                                                                                      |                                                                                 |                  |         |
| 9.1                                                                                              | Provider interface with `MockProvider` writing to `ReminderLog`, selected by env var                                 | Tests run with the mock only                                                    | done             | bdf645f |
| 9.2                                                                                              | Reminder job: one message per employee with due/overdue follow-ups, idempotent per employee per day (rule 10)        | Running the job twice sends once                                                | done             | bdf645f |
| 9.3                                                                                              | Admin reminder settings (on/off, send time), "Send now", sent log, employee reminder panel                           | Tests pass                                                                      | done             | 8787f01 |
| 9.4                                                                                              | Meta WhatsApp Cloud API provider with approved template; delivery-status webhook with signature verification         | Tests pass against a simulated Meta API. **Not verified live** (no credentials) | done (simulated) |         |
| **Phase 10: Hardening and release**                                                              |                                                                                                                      |                                                                                 |                  |         |
| 10.1                                                                                             | Playwright E2E: admin uploads, assigns, employee works a lead, admin sees activity                                   | E2E suite passes                                                                | done             |         |
| 10.2                                                                                             | Authorization test matrix: employee vs every admin route; employee A vs employee B's lead (IDOR)                     | Matrix passes                                                                   | todo             |         |
| 10.3                                                                                             | Input validation and error-format review, request logging, dependency audit                                          | Review done, audit clean or documented                                          | todo             |         |
| 10.4                                                                                             | Mobile QA pass on every screen at 360, 390, 768 px, with fixes                                                       | All screens checked and fixed                                                   | todo             |         |
| 10.5                                                                                             | Production Dockerfiles, deployment notes, database backup plan (**ask about hosting first**)                         | Images build; notes and backup plan written                                     | todo             |         |
| 10.6                                                                                             | README, environment variable docs, final Progress log with known gaps                                                | Docs complete                                                                   | todo             |         |

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

### T2.3 note

`guard()` now returns 403 `PASSWORD_CHANGE_REQUIRED` for any user with `mustChangePassword` on every route except those marked `config: { allowTempPassword: true }` (`/auth/me`, `/auth/change-password`; `/auth/logout` is unguarded). Login still succeeds so the UI can show the change screen. `POST /api/auth/change-password` {currentPassword, newPassword}: new password min 10 chars, must differ from the current one; wrong current → 422 `INVALID_CURRENT_PASSWORD`, limited to 5 failures/15 min per user (429). Applies to admins too. Verified by mutation (3 tests fail without the check). 6 tests.

- **Gap:** changing a password does not end the user's _other_ sessions (stateless JWT; same root cause as the logout gap).
- **Gap:** no "forgot password" or admin password reset exists; a locked-out employee currently cannot be recovered except by deactivating them and creating a new account (their email is then taken). Not in the spec; tell me if you want one.

### T3.2 note

`GET /api/leads` (any signed-in role). Filters: `owner` (user id or `none`), `status`, `stale`, `search`, `page`, `pageSize` (default 25, max 100); bad values → 422. **Scoping:** `services/lead-access.ts → leadScope(user)` is the single place rule 3 lives (employee ⇒ `owner_id = me`); it is part of the SQL WHERE of the list _and_ the count, so totals cannot leak other people's lead counts. **Every later lead query (detail, status, follow-up, calls, notes, contact events) must use it.** Employees cannot see the unassigned pool at all. A foreign `owner` filter is ANDed with the scope, so it returns an empty page rather than an error.

- Search: name and company (case-insensitive, `%`/`_` escaped so they are literal), plus phone when the term has 3+ digits (any format).
- Stale (rule 9) is computed in SQL from `lastActivityAt` and the `staleDays` setting; Won/Lost are never stale. Each row carries `isStale`, `ownerName`, `lastActivityText` (newest history line).
- Order: admins newest-first; employees open-before-closed, soonest follow-up first (nulls last), as in the prototype. Ties break on id so pages are stable.
- Verified by mutation: removing the scope from the query fails 6 tests. 18 tests, including a sweep over every employee × many filter/search/paging combinations asserting only own leads are returned.
- **Open point for 8.3:** the prototype's Follow-ups tab shows only leads with a follow-up date, and "My leads" a due count. With server-side paging the UI may need a `followUp=due|set` filter. It is not in the spec'd filter list, so I have not added it; will raise at 8.3 rather than invent it now.
- Sandbox note: the embedded Postgres stops between sessions; restart with `node scripts/dev-postgres.mjs /tmp/leadbook-pg`.

### T3.3 note

`GET /api/leads/:id` (any signed-in role) returns `{ lead, timeline, timelineTruncated, staleDays }`. The lookup is `WHERE id = :id AND <leadScope>` in one query, never fetch-then-check, so another employee's lead and a nonexistent id return the **same 404 body** (tested for equality, and the body contains no name/owner). Unassigned leads are 404 for employees. Timeline is newest first with actor names; capped at 500 entries (flag `timelineTruncated`). Activity `meta` is deliberately not returned (it can hold other employees' ids). An IDOR sweep checks every employee × every lead: 200 iff owner, else 404. Mutation-checked (4 tests fail without the scope). 9 tests.

### T3.4 note

`POST /api/leads/upload` (admin only). **Body is JSON** `{ csv, mode, ownerId? }`, not multipart: the UI reads the chosen file (or pasted text) in the browser and sends the text, exactly like the prototype, so one endpoint serves both "file" and "paste". Limits: 5,000 data rows, 5 MB (`bodyLimit` 6 MB; auth runs in `onRequest`, so anonymous clients are rejected before the body is read).

- **Columns:** `name`, `phone` required; `company`, `source` optional (source defaults to "Other"); any order/case, extra columns ignored; `,` `;` or tab separated; quotes, CRLF, BOM handled (`csv-parse`). Phones normalized to E.164 with `DEFAULT_COUNTRY_CODE`.
- **Modes:** `none` (pool), `split` (each new lead to the currently least-loaded active employee, ties by account age), `owner` (+`ownerId`, must be an active employee). Deactivated employees never receive leads.
- **Report:** `{ summary:{rows, added, skipped, skippedInFile, skippedExisting, invalid}, skipped[], invalid[], assignment }`, every entry with its file row number and a reason (lists capped at 500, `reportTruncated` says so). Bad rows do not block good ones; whole-file problems (no `name`/`phone` header, empty, header-only, unreadable quoting, >5000 rows) return 422 `INVALID_FILE` and add nothing.
- **Duplicates:** inside the file (any phone spelling; first row wins) and against the database. The database check is the unique index via `ON CONFLICT DO NOTHING`, **not** check-then-insert, so two simultaneous uploads add each lead exactly once (tested with a race of two identical 40-row uploads). Existing leads are never modified by an upload.
- **Atomic:** one transaction (leads, history, assignment); a forced failure mid-way leaves zero new leads or history rows. Active employees are locked in the same order as deactivation, so an upload cannot hand leads to an employee who is being deactivated.
- History written per new lead: "Uploaded by <admin name>" then, if assigned, "Assigned to <employee>" (timestamps use `clock_timestamp()` so the order is reliable inside a transaction).
- Mutation-checked: removing `ON CONFLICT` fails 3 tests. 28 tests (11 parser + 17 API).
- **Not handled:** spreadsheet "formula injection" (cells starting `=`, `+`, `-`, `@`) is not neutralised because nothing in the spec exports data; revisit if an export feature is ever added.

### T3.5 note

`POST /api/leads/:id/assign` {ownerId: employee id | null} (admin only; null = back to the pool, as the prototype's "Unassigned" option). Returns `{ changed, lead, timeline }`. History: "Assigned to <name>" (type ASSIGNED) or "Moved back to unassigned pool" (UNASSIGNED), actor = admin, `meta {fromOwnerId, toOwnerId}`. Assigning to the current owner is a no-op with no history. Only active employees are valid targets (422 otherwise; admins, unknown, malformed also 422). Won/Lost leads can be reassigned (the prototype allows it); nothing but the owner changes. Employees get 403 even on their own lead.

- **Locking (important for 3.6 and anything else touching employees + leads):** `services/locks.ts → lockActiveEmployees(tx)` must be taken FIRST, then lead rows. Deactivation, upload and assign now all use it. I refactored deactivation and upload onto the helper; their tests still pass.
- **How the tests were checked:** my first concurrency tests did not fail under mutation. Reasons found: (1) removing only the lead row lock is an _equivalent_ mutant, since every assignment already serializes on the shared employee locks (the lead lock is defense in depth); (2) my deactivation race started with an unassigned lead, so no deadlock could form. Fixed by adding a test where the lead is owned by the employee being deactivated while it is moved to another. Now: inverted lock order reproduces a real deadlock and fails the test; removing all locks fails 4 tests; real code passes 12/12.
- **Consequence to be aware of:** because assign/upload/deactivate/auto-assign share the employee lock, they run one at a time system-wide. These are rare admin actions, so that is fine; revisit only if upload volume ever becomes large.

### T3.6 note

`POST /api/leads/auto-assign` (admin only): every unassigned **open** lead goes, in order, to the currently least-loaded active employee (load = open leads; Won/Lost do not count). Returns `{ assigned, byEmployee[] }`; history "Assigned to X" with `meta { fromOwnerId:null, toOwnerId, auto:true }`. 409 `NO_ACTIVE_EMPLOYEES` if nobody is active. Idempotent (a second run assigns 0 and writes nothing).

- **Decision to confirm:** unassigned Won/Lost leads are _not_ auto-assigned (the prototype would hand them out too; giving employees dead leads seems pointless, and they only reach the pool by an explicit admin "unassign"). Say if you want the prototype behaviour.
- Least-loaded logic is now one shared function (`services/least-loaded.ts`) used by both upload "split" and auto-assign. Ties go to the longer-standing account, then id.
- **Bug found and fixed while testing:** deactivation stamped its history with `now()` (= transaction _start_), so after waiting on a lock it could sort _before_ an assignment it actually followed, showing events in the wrong order. Now uses `clock_timestamp()`; the new ownership-chain invariant (`test/invariants.ts`) fails without that fix.
- **Tests:** 10. Concurrency: 3 simultaneous auto-assigns (each lead handled exactly once, balanced ±1), and auto-assign racing an upload, two single assigns, a deactivation and another auto-assign (no 500s, connected ownership chains, no open lead left with an inactive employee). Mutation-checked: removing all locks fails the concurrency tests. A flaky _test_ (assumed a tie went one way) was found by repeated runs and fixed; 15 consecutive runs and 3 full-suite runs are clean.

## Phase 3 summary (Leads core) — complete

**Done:** phone normalization, scoped list, owner-scoped detail with timeline, CSV upload, assign/reassign, auto-assign. 179 API tests, all against a real Postgres.
**Rule coverage:** 1 (one owner; chain + lock tests), 2 (E.164 + unique index; duplicates reported, never overwritten), 3 (single `leadScope` in every query; IDOR sweeps; same 404 for foreign and missing), 6 (every change writes history), 7 (deactivation returns open leads).
**Design rule worth remembering:** any transaction touching both employees and leads takes `lockActiveEmployees()` first. Consequence: assign / upload / auto-assign / deactivate run one at a time system-wide (fine for rare admin actions).
**Untested / gaps:** upload of the full 5,000-row maximum (tested 1,500); no per-lead edit endpoint for name/phone/company (not in spec; users will ask); reassigning does not notify the employee (reminders only); `Follow-ups` UI may need a `followUp` list filter (see T3.2).

### T4.1 note

`PATCH /api/leads/:id/status` (`guard("EMPLOYEE")`, owner only through `withOwnedLead`, which locks the lead row and puts id + `leadScope` in one query). Lost needs a reason (422 `LOST_REASON_REQUIRED`); a reason on a non-Lost status is 422; reopening clears it; Won/Lost clear the follow-up date; same status is a no-op with no history; changing only the Lost reason is recorded. History: `Status: A → B` / `Status: A → Lost (Reason)`, stamped with `clock_timestamp()` and bumping `lastActivityAt` (so it ends staleness). Shared helpers `lead-work.ts` (`withOwnedLead`, `addActivity`) and `lib/labels.ts` will serve 4.2-4.4. Mutation-checked: removing the reason check and removing the owner scope each fail a test. 17 tests; suite 196 API + 1 web.

### T4.2-T4.4 note

Built and tested together (they share `withOwnedLead`/`addActivity` and one test file), so they are in one commit rather than three.

- `POST /:id/calls` {outcome ANSWERED|NO_ANSWER|BUSY|WRONG_NUMBER}: writes `Call: <Outcome>`; on a New lead then `Status: New → Contacted` (any outcome, as in the prototype); No answer / Busy then set the follow-up to tomorrow in `APP_TIMEZONE` and write `Follow-up set to DATE`. **Deviation:** on a Won/Lost lead the call is logged but no follow-up is set (closed leads carry no follow-up).
- `POST /:id/notes` {text 1..2000, trimmed} writes `Note: text`; allowed on closed leads. Stored and returned as plain data.
- `PATCH /:id/follow-up` {date YYYY-MM-DD real date | null}: past dates allowed (shows as overdue); unchanged is a no-op with no history; a date on a Won/Lost lead is 422 `LEAD_CLOSED` (clearing is allowed).
- `POST /:id/contact-events` {kind CALL|WHATSAPP} writes `Call started from app` / `WhatsApp chat opened` (CONTACT_EVENT); counts as activity (ends staleness) but changes nothing else.
- All `guard("EMPLOYEE")`: owner 200, other employee or unassigned or missing 404 (identical bodies), admin 403, anonymous 401; reassignment cuts off the old owner at once. 33 tests; mutation-checked (no New→Contacted, Busy without follow-up, no-op detection removed: each fails tests). Suite: 229 API + 1 web.

### T5.1-T5.5 note

All admin-only (`guard("ADMIN")`; employee 403, anonymous 401, tested on every route). Numbers come from SQL aggregates (`services/stats.ts`) and the tests recompute every figure independently from the raw rows. Definitions: **open** = not Won/Lost; **overdue** = open with follow-up date before today in `APP_TIMEZONE` (today's date is not overdue); **stale** = rule 9 via the same `staleExpr` as the lead list, so the two never disagree.

- `GET /api/stats/overview`: total, unassigned, open, won, lost, overdue, stale, staleDays, today.
- `GET /api/stats/team`: one row per **active** employee (deactivated ones drop out; their open leads are back in the pool): assigned, notContacted (New), worked (not New), won, lost, overdue, lastActivityAt (their latest action on any lead, null if none). Employees with no leads appear with zeros.
- `GET /api/stats/stale`: stale leads oldest first with owner name; capped at 200 rows, `total` is the full count.
- `GET /api/stats/lost-reasons`: counts per reason, largest first, labels attached; empty list when nothing is lost.
- `GET /api/activity?page&pageSize`: newest first, default 40, max 100, stable order (createdAt, id); pages tested to cover every entry exactly once.
- `GET/PUT /api/settings`: `staleDays` integer 1..30, unknown keys rejected (422); a corrupted stored value falls back to 2. Reminder settings join this endpoint in 9.3.
- Mutation-checked: counting closed leads as overdue, including deactivated employees, loosening the guard, ignoring the page offset: each fails a test. 33 tests; suite 262 API + 1 web.

### T6.1-T6.3 note

`apps/web`: Vite 8, React 19, Tailwind 4 (palette and dark mode taken from the prototype's CSS variables), React Router 7, TanStack Query 5. Built together in one commit.

- **Same-origin API.** The browser calls `/api/...` on its own origin; Vite (dev and preview) proxies `/api` and `/health` to `VITE_API_URL`. This keeps the `SameSite=Strict` cookie first-party and needs no CORS in dev. In production the web build and API must share a site (to be covered in DEPLOY notes, 10.5).
- `lib/api.ts`: one fetch wrapper; every error becomes `ApiError{status, code, message, details, retryAfter}` from the API's single error shape; network failure is a friendly `NETWORK` error.
- `lib/auth.tsx`: `/api/auth/me` decides who is signed in (401 = signed out, anything else = server problem shown with a Try again button, never a misleading login page). Login/logout drop every other cached query so the next person on the browser never sees the previous user's data.
- Routes: `/login`, `/change-password`, `/admin/*` (admin only), `/app/*` (employee only). Wrong role is redirected to its own home; temp-password users are forced to change it first; after login the user goes back to the page they wanted if their role may be there. This is UX only: the API enforces every rule.
- Shell: header (brand, role tag, name from 640px up, theme button, sign out), horizontally scrollable tab strip, light/dark/auto theme remembered per browser (applied before first paint). A failed sign-out keeps the user signed in and says so (the cookie is still valid).
- **Placeholders:** each tab shows a "built in a later task" panel until Phases 7-8 replace it. None may remain at the end (checked in 10.6).
- Found by tests and fixed: `qc.clear()` detached the session query so the UI never updated after login/logout; the login page's own redirect discarded the "return to where you were headed" target.
- Verified in real Chrome (headless, system google-chrome) against the running API: login through the proxy works; no horizontal overflow at 360 and 768 px in light and dark; tab strip scrolls at 360; "Sign out" no longer wraps. 18 web tests (jsdom, mocked fetch); mutation check: removing the wrong-role redirect fails 2 tests.
- Known: production bundle is ~523 kB (159 kB gzip), above Vite's 500 kB warning; code-splitting by route is a 10.4 candidate.

### T7.1-T7.6 note

All admin screens use the real API (no mock data in the app). Every screen has loading, error (with Try again) and empty states; shared `QueryState`, `Empty`, `ConfirmDialog` in `components/ui.tsx`. Built together in one commit.

- **Overview:** flow strip, five stat tiles, team table (names link to `All leads` filtered to that employee), stale panel with the days input (saves on blur/Enter, validated 1-30 before calling the API, refreshes every stale count), lost-reason panel.
- **All leads:** search (debounced 300 ms, one request per pause), status/owner/stale filters, pagination, all kept in the URL so reload/back/links work. Desktop table at 768px and up, compact card list below that (one layout rendered, not both). Owner dropdown reassigns in place (or returns the lead to the pool) and shows the API's message on failure. A lead whose owner is now inactive still shows that owner as the current value.
- **Lead drawer (read-only):** URL-driven (`?lead=ID`), Escape/backdrop/Close, page behind does not scroll, focus moves into it. Shows owner, follow-up, source, stale and lost tags and the full history. A missing lead shows "Lead not found" (the drawer takes an `actions` slot that Phase 8 uses for employee controls).
- **Upload:** file or paste, three assignment modes, client checks (empty, no employee chosen, over 5 MB) before calling the API, result report with added/skipped/invalid counts and row-level reasons, truncation notice, sample CSV download.
- **Team:** add employee shows the temporary password once with a Copy button; deactivate asks first (names the open-lead count); the API's "last active employee" error is shown; reactivate; Auto-assign shown only when something is unassigned and reports who received what. A failed or cancelled confirm changes nothing.
- **Activity:** 40 per page, Newer/Older, entry opens the lead drawer.
- **Reminders tab** remains a placeholder until 9.3.
- Verified in real Chrome against the running API and seed data (desktop and 360 px; no horizontal overflow; drawer opens from the table). The expected 401 from the signed-out `/me` check shows in the console on the login page; nothing else. 43 web tests; mutation-checked: opening deactivate without the confirm step and removing the search debounce each fail tests.
- Not done: no admin "edit lead" or "delete lead" (not in the spec); no CSV export.

### T8.0-T8.3 note

**API additions (no data-model change), committed as 1a96d5a:** `GET /api/leads?followUp=due|scheduled` (open leads with a follow-up on/before today, or with any date; scoped by role like every list) and `GET /api/leads/summary` (employee only: total, notContacted, followUpsDue, won, today). Both are needed by the prototype's employee screens. Tested including scoping and mutation checks (summary without `leadScope` fails; due without the open-status condition fails). 9 tests.

- **My leads:** four tiles (my leads, not yet contacted, follow-ups due, won) and cards ordered by the API (open first, soonest follow-up first), with Stale, overdue and due-today markers. Overdue/today use the server's `today` in `APP_TIMEZONE`, so the browser's clock and timezone cannot disagree with reminders. Closed leads are never shown as overdue.
- **Working drawer (8.2):** Call (`tel:`) and WhatsApp (`wa.me`, opens in a new tab with `noopener`, greeting pre-filled with the employee's name) links that log a contact event on tap (a failed log never blocks the call); status select, where choosing Lost opens the reason box and sends nothing until a reason is picked (Cancel changes nothing; the select keeps showing the real status); follow-up date (disabled on Won/Lost with an explanation); the four call outcomes; note box (Enter works, whitespace-only blocked, text kept if the request fails). Every action returns the refreshed lead + history, so the drawer updates at once, and the lists and tiles refetch.
- **Employee cannot see another employee's lead, even by URL:** `?lead=<someone else's id>` shows "Lead not found." with no controls (the API's 404 is identical to a missing id). Employees typing `/admin/...` land on My leads. Verified in real Chrome at 390 px.
- **Follow-ups tab:** my open leads with a date, soonest first; empty state.
- **8.3 is PARTIAL:** the reminder panel (what the employee has been sent, and whether reminders are on) depends on the reminder settings and log, which do not exist until 9.1-9.3. It is built in 9.3 and 8.3 is then marked done.
- Fixed while verifying: my dev API process was running pre-change code, so `/api/leads/summary` hit `/:id` (422). Restarting fixed it; a reminder that `pnpm start` has no watch mode (`pnpm dev` does).
- 60 web tests (17 for the employee screens); mutation check: sending Lost without the reason box fails 2 tests.

### T9.1-T9.2 note (and the API half of 9.3)

- **Provider interface** (`whatsapp/provider.ts`): `send(message) -> SENT | FAILED`, never throws for delivery problems. `MockProvider` sends nothing, keeps what it "sent" and can be told to fail; selected by `WHATSAPP_PROVIDER` (default `mock`), and every automated test uses it. **Deviation from the prompt's wording:** the job (not the provider) writes the `ReminderLog` row, so every provider is logged identically and the log cannot be forgotten by a new provider.
- **Message** (`reminder-message.ts`): fits a Meta template, `Hi {{1}}, you have {{2}} due today or overdue: {{3}}. Open Leadbook to update them.` Variables never contain line breaks, tabs or runs of spaces; names only (no customer phone numbers); at most 5 names then "and N more"; names cut at 40 characters; "(overdue)" only for dates before today.
- **Job** (`services/reminders.ts`): per active employee with a phone, open leads with a follow-up on or before today (in `APP_TIMEZONE`), their own leads only. SCHEDULED claims its `ReminderLog` row with INSERT ... ON CONFLICT DO NOTHING against the unique (employee, date) index and only the winner sends, so running twice, six at once, or from two servers sends once (rule 10). A second reminder for someone who becomes due later the same day is not sent (one per day); the next day sends again. A failed send is a FAILED row; the scheduled job does not retry it (the day's attempt is spent) and an admin can use Send now. Employees with due follow-ups but no number are reported (`noPhone`), not silently skipped.
- **Send now** (MANUAL kind): needs reminders turned on (409 otherwise); not limited per day, but not repeated within 60 s for the same employee. **Real bug found by a tighter test:** two simultaneous clicks both passed the cooldown check and sent 3-4 messages instead of 2 (read-then-insert race). Fixed with a per-employee `pg_advisory_xact_lock` around check-and-claim; 6 clean repeat runs, and removing the lock fails the test.
- **Scheduler** (`scheduler.ts`): in-process, checks every minute and at start-up; sends once per day after the chosen `reminderTime` in `APP_TIMEZONE`; a restart after the time is harmless because the database remembers. `SCHEDULER_ENABLED=false` turns it off (tests, or if you trigger the job externally). Known limit: if the server is down for the whole day nothing is sent for that day.
- **Settings:** `GET/PUT /api/settings` now also carry `reminderEnabled` (off until an admin turns it on) and `reminderTime` (`HH:MM`, validated); partial updates, unknown keys rejected, empty update rejected.
- **Endpoints:** `GET /api/reminders/due` (preview of who would get what), `POST /api/reminders/send-now`, `GET /api/reminders/log` (paged), `GET /api/reminders/mine` (employee: on/off, time, own number, last 3 own messages only). All role-guarded and tested (admin 403 on the employee one, employee 403 on the others).
- Mutation-checked: removing the claim's ON CONFLICT, the active-employee filter, the closed-lead filter, the due-date bound and the advisory lock each fail tests. 16 job tests, 9 message tests, 27 route/settings tests; suite 323 API + 60 web.
- Still to do for 9.3: the admin Reminders screen and the employee panel (web). 9.4 not started.

### T9.3 note (web half; completes 8.3)

- **Admin Reminders tab:** on/off checkbox (saves at once); time box saves on blur/Enter, not on every keystroke (a time input fires `change` per typed segment, which saved half-typed values like 09:59 until a test caught it); "Send all due now" (disabled when reminders are off or nobody reachable is due), result line with sent / failed / skipped / no-number counts; a preview per employee with the exact message in a WhatsApp-style bubble; warning for employees without a number; the sent log (Daily vs Send now, failed marked, paged). The page says **"Test mode: nothing is actually sent to WhatsApp"** whenever the provider is `mock`, so nobody believes messages went out.
- **Employee panel (on Follow-ups):** off / on-at-time-to-number / no-number-on-file states and the last 3 messages received, failed ones marked.
- The Placeholder component is deleted: no placeholder screens remain.
- Verified in real Chrome against the running API: turning reminders on, Send now sent 1 reminder (Rohan, his own overdue lead only), a second click was skipped as "sent a moment ago", the log showed it, and Rohan's Follow-ups tab showed the same message.
- 11 web tests for these screens; 71 web + 323 API in total.
- **Observed once, not reproduced:** `signs out, calls the API, and returns to login` failed once in ~35 full runs (28 ms, so not a timeout); 22 further runs including the full parallel suite were clean. Raised the Testing Library async timeout to 4 s to cut load-related risk. Treat as a possible rare flake and watch for it in 10.1.

## Phase 2 summary (Team management) — complete

**Done:** create/list employees with a one-time temporary password, deactivate/reactivate with race-free last-employee protection and full rollback, forced first-login password change. 102 tests total (24 new in this phase), all against a real Postgres. Mutation-checked: the row lock, the forced-change gate.
**Untested:** the temporary password is shown to the admin on screen only; there is no email/SMS delivery path to test.
**Known gaps:** password reset/recovery missing (above); other sessions survive a password change.

## Phase 1 summary (Database and auth) — complete

**Done:** schema + migrations with DB-level rules, seed, login/logout/me, role guard, rate limiting/headers/CORS. 78 tests, all run against a real Postgres (fresh database per suite).
**Untested here:** `docker compose up`; Node 20 (sandbox runs 22); more than one API instance.
**Known gaps:** (1) logout cannot revoke an already-copied JWT until it expires (needs a token-version column; owner has not asked for it); (2) rate-limit counters are in memory; (3) no password-reset flow exists and none is specified; (4) `SameSite=Strict` requires web and API on the same site.

### T9.4 note (Meta provider + webhook; NOT verified against live Meta)

- No credentials were provided, so the code is tested only against `test/fake-meta.ts`, a local HTTP server that mimics the Cloud API. Request shapes follow Meta's documentation; real-world differences (error codes, template approval, rate limits) are unverified. See `docs/WHATSAPP.md` for the go-live checklist.
- `MetaProvider`: one attempt, no retry (a retry could double-send), 10 s timeout, token never in errors. A 200 without a message id counts as FAILED.
- Webhook `/webhooks/whatsapp` is mounted only when `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` are set. HMAC-SHA256 over the raw bytes, timing-safe compare; status moves forward only (SENT < DELIVERED < READ), FAILED only from PENDING/SENT. Removing the comparison makes 5 tests fail.
- Failure reasons from Meta are not stored (no error column; no data-model change), only logged.

### T10.1 note (Playwright E2E)

- `e2e/` workspace, run with `pnpm test:e2e`. It uses the system Chrome (`channel: "chrome"`, no browser download), builds a throwaway database `leadbook_e2e` (`apps/api/src/test/e2e-prepare.ts`: drop, create, migrate, seed), then starts the API on :3100 and Vite on :5273. It needs a running Postgres at `localhost:5432` (override the admin URL with `E2E_ADMIN_DATABASE_URL`).
- 7 serial specs: admin uploads and assigns (with an invalid row), duplicate re-upload skipped, Priya calls/notes/changes status/marks Lost with a reason (rule 8 checked), Priya cannot open Rohan's lead by URL, employee redirected from admin, admin sees the activity, sign-out ends the session.
- Mutation check: making `leadScope` return no filter fails the IDOR spec; restored.
- 3 clean runs. Selector lesson: labels wrap their control, so the accessible name includes the current value; specs use `label:has-text(...) select`.

## Status at last checkpoint

Done: Phases 0–5 (backend for admin and employee work complete). Phase 6 (frontend foundation) done. Phases 7 and 8 done except the reminder panel (8.3, built in 9.3). Phase 9 done (Meta provider simulated only). Next: Phase 10. \*`docker compose up` unverified (no Docker daemon in sandbox).
