<h1 align="center"><strong> The School Management App : Internal / Developer Documentation </strong></h1>

This document describes what is actually implemented in this codebase. It is
for internal admin, developer, and preview use only. Do not distribute this
document to customers : see `README-product.md` for the public-facing
version.

## 1. Architecture overview

```
frontend (static HTML/CSS/vanilla JS)
        |
        v
backend API (Node.js / Express)
        |
        v
SQLite (development/prototype) : swappable to PostgreSQL for production
```

The frontend never talks to the database directly and never makes an
authorization decision that matters : every permission, tenant-ownership,
and subscription check is enforced again on the server, on every request.
Frontend role checks exist purely to route the person to the right page and
avoid a flash of the wrong UI; a server response of 401/402/403 is what
actually protects data.

## 2. Folder structure

```
app/
  backend/
    src/
      app.js                 Express app assembly (middleware, routes)
      server.js               Process entry point
      config/permissions.js   Single source of truth for roles & permissions
      db/
        connection.js         better-sqlite3 connection singleton
        migrate.js             Migration runner
        migrations/001_init.sql  Full schema
        seed.js                 Roles/permissions + bootstrap admin + demo data
      middleware/
        auth.js                Session -> req.user, requireAuth/requirePermission/requireRole
        tenant.js               Session -> req.school/req.schoolId, subscription enforcement
        rateLimits.js           express-rate-limit configs
        errorHandler.js         Central error handler (never leaks stack traces)
      services/
        authService.js         Login attempt logic, lockout, MFA check
        auditService.js         Audit log + security event writer
        subscriptionService.js  Authoritative subscription status calculation
      routes/
        authRoutes.js           Login, logout, /me, password reset, MFA setup
        onboardingRoutes.js     Trial signup, staff invitations
        adminRoutes.js          Platform Admin routes (schools, vouchers, security, incidents)
        schoolRoutes.js         School-tenant routes (students, staff, fees, expenses, ...)
        dashboardRoutes.js      Per-role dashboard summary/chart data
      utils/                    ids, passwords, validation helpers
      jobs/subscriptionSweep.js Hourly subscription status sweep
      tests/                    Integration test suite (node --test)
    .env.example
    package.json
  frontend/
    public/
      index.html                Login / start-trial page (preserved visual identity)
      accept-invitation.html
      reset-password.html
      css/  (auth.css is the original template, untouched; dashboard.css and
             auth-overrides.css are additive)
      js/   (api.js, dashboard-shell.js, auth.js, and one file per dashboard)
    pages/dashboards/
      admin.html, sed.html, head-teacher.html, accountant.html
  docs/
    README-product.md          Public documentation
    README-internal.md         This file
```

## 3. Authentication

- Passwords are hashed with **bcrypt** (12 rounds) via `src/utils/passwords.js`.
  This choice is a pragmatic one for a sandboxed/portable prototype with no
  guaranteed native build toolchain. **For a real production deployment,
  switch to Argon2id** (the `argon2` package): replace `hash()`/`verify()`
  in that file, and re-hash any existing bcrypt hash the next time that user
  logs in successfully.
- Sessions are server-side (`express-session`), identified by an httpOnly,
  SameSite=Lax cookie. `COOKIE_SECURE=true` must be set in production
  (requires HTTPS).
- Session IDs are regenerated on every successful login to prevent session
  fixation.
- Failed logins increment a per-account counter; 5 failures locks the
  account for 15 minutes (`src/services/authService.js`). This is on top of
  a per-IP rate limiter on `/api/auth/login` (`src/middleware/rateLimits.js`).
- Password reset and staff invitations use single-use, SHA-256-hashed,
  time-limited tokens. The raw token is only ever shown once (returned in
  the API response in non-production environments only, since no email
  provider is wired up in this prototype : see section 11).
- TOTP-based MFA is implemented (`otplib`) and available to any account via
  `/api/auth/mfa/setup` and `/api/auth/mfa/enable`. It is not force-enabled
  for any role in this prototype; enforcing it for Platform Admin accounts
  specifically is a one-line policy check to add in `onboardingRoutes.js`'s
  Admin provisioning path before go-live.

## 4. Authorization (RBAC)

`src/config/permissions.js` is the single source of truth for roles and
permissions. `src/db/seed.js` writes this into the `roles`, `permissions`,
and `role_permissions` tables. `src/middleware/auth.js` resolves a logged-in
user's roles and permission set from the database on every request
(`attachUser`), and `requirePermission(...)` / `requireRole(...)` enforce it
on each route. A denied check is written to `audit_logs`.

| Role | Key permissions | Notably NOT permitted |
|---|---|---|
| PLATFORM_ADMIN | platform.read, platform.manage_schools, platform.manage_subscriptions, platform.manage_vouchers, platform.view_system_health, platform.view_security_logs, platform.manage_incidents | Any school financial data (fees, payments, expenses, profit) : the admin router does not join those tables at all |
| SED | school.read, finance.read, profit.read, reports.read, students.read, staff.read, academics.read, resources.read, infrastructure.read, expenses.read, fees.read, school_users.manage | students.manage, staff.manage, expenses.manage, infrastructure.manage (SED is read-only + can invite staff, by design) |
| HEAD_TEACHER | students.read/manage, academics.read/manage, staff.read, resources.read, infrastructure.read/manage, expenses.read | finance.read, profit.read (no profit visibility) |
| ACCOUNTANT | students.read, enrollment.manage, fees.read/manage, payments.manage, expenses.read/manage, staff.read/manage | infrastructure.manage, profit.read, finance.read |

This is enforced and tested : see section 9, the automated test matrix.

## 5. Multi-tenancy

Every school is a tenant. `src/middleware/tenant.js`'s
`requireSchoolContext` resolves `req.schoolId` **exclusively from the
authenticated session** (`req.user.schoolId`), never from a URL parameter,
header, or request body. Every school-scoped query in `schoolRoutes.js` and
`dashboardRoutes.js` filters by `req.schoolId`. A request for a resource
belonging to another school returns 404, not 403 : the resource simply does
not exist within the caller's tenant scope, which avoids confirming to a
would-be attacker that the resource exists elsewhere.

Public-facing resource identifiers (`stu_...`, `fee_...`, `pay_...`, etc.)
are random UUID-based strings (`src/utils/ids.js`), not sequential
database IDs. This is a UX/obfuscation measure only, not a substitute for
the tenant-scoping check described above.

## 6. Subscription lifecycle

`src/services/subscriptionService.js` is the single authority for a
school's subscription status: `trial → active → expiring_soon →
grace_period → expired`, with `frozen`/`suspended`/`cancelled` as
Admin-controlled states. Status is computed from `subscriptions.ends_at`
and re-derived (never trusted from a stored value alone) by:

- `src/middleware/tenant.js`'s `enforceSubscriptionForWrites`, on every
  school-scoped request, which blocks POST/PUT/PATCH/DELETE (but not GET)
  once a school's status no longer allows operational writes.
- `src/jobs/subscriptionSweep.js`, which runs hourly and persists any status
  transition, writing an audit log entry for each one.

Grace period length is 7 days (`GRACE_PERIOD_DAYS` in
`subscriptionService.js`); "expiring soon" is also a 7-day window before
expiry. Both are easy to make configurable per-plan if needed.

## 7. Vouchers

Vouchers are issued by a Platform Admin (`POST /api/admin/vouchers`) as a
random token; only its SHA-256 hash is stored. Redeeming a voucher
(`POST /api/admin/vouchers/redeem`) extends a school's subscription by the
voucher's `duration_days`, calculated **entirely server-side** from the
school's current `subscriptions.ends_at` (extending from the later of "now"
or the current expiry, so unused time is not lost). The client only ever
supplies a voucher code and a school id : never a duration.

In this prototype, only a Platform Admin can redeem a voucher on a school's
behalf. Letting a school redeem its own voucher code directly is a
reasonable Version 2 addition (a new `POST /api/school/vouchers/redeem`
route restricted to `school_users.manage` or a new permission, with the
same server-side duration calculation).

## 8. Audit logging & security events

`src/services/auditService.js` writes to two tables:

- `audit_logs` : business actions (created/updated/status-changed on any
  resource, authorization denials, subscription transitions, voucher
  issuance/redemption, school freeze/unfreeze).
- `security_events` : authentication-adjacent events (failed logins,
  account lockouts, MFA failures).

Neither table is ever written with a password, token, or other secret value.
`GET /api/admin/audit-logs` and `GET /api/admin/security-events` expose
these to Platform Admins holding `platform.view_security_logs`.

## 9. Testing

Run the automated suite with:

```bash
cd app/backend
npm install
npm test
```

This runs `src/tests/api.test.js` against a real, temporary SQLite database
and a real running instance of the Express app (not mocks). It covers the
test matrix below.

### Test matrix (implemented and passing)

| Actor | Action | Expected | Verified by |
|---|---|---|---|
| SED | Read own dashboard incl. profit | Allowed | `api.test.js` |
| Head Teacher | Read SED profit dashboard | Denied (403) | `api.test.js` |
| Accountant | Create infrastructure project | Denied (403) | `api.test.js` |
| Accountant | Record a payment | Allowed (201) | `api.test.js` |
| School user (any role) | Reach a platform admin route | Denied (403) | `api.test.js` |
| Platform Admin | List schools | Allowed, with no financial fields in the response | `api.test.js` |
| School B user | Read School A's students | Returns School B's own data only | `api.test.js` |
| School B user | Record a payment against a School A fee id | Denied (404) | `api.test.js` |
| Expired school user | Read own records | Allowed | `api.test.js` |
| Expired school user | Create a staff record (write) | Denied (402) | `api.test.js` |
| Any account | 5 consecutive failed logins, then a 6th attempt | Locked (423), even with the correct password | `api.test.js` |
| Trial signup | Submit `role: "PLATFORM_ADMIN"` in the request body | Ignored : account is created as SED only | `api.test.js` |

To extend this matrix (e.g. Admin unfreezing a school, voucher redemption,
MFA enrollment), add cases to `src/tests/api.test.js` following the existing
pattern : the test app boots against an isolated temp SQLite file per run,
so tests do not interfere with your development database.

## 10. Demo accounts

Running `npm run seed` (see section 12) creates:

**Platform Admin** (from `.env`'s `BOOTSTRAP_ADMIN_EMAIL`/`PASSWORD` :
only created if no Admin account exists yet):
- Email: value of `BOOTSTRAP_ADMIN_EMAIL`
- Password: value of `BOOTSTRAP_ADMIN_PASSWORD`

**Two demo schools** (non-production environments only : the seed script
skips demo data when `NODE_ENV=production`), password `DemoPass!2026` for
every demo account:

| School | SED | Head Teacher | Accountant | Notes |
|---|---|---|---|---|
| Uwezo Secondary School (Demo) | sed@uwezo.demo | headteacher@uwezo.demo | accountant@uwezo.demo | Active subscription, ~300 days remaining |
| Amani Primary School (Demo) | sed@amani.demo | headteacher@amani.demo | accountant@amani.demo | Active but expiring in ~12 days : use this one to see the "expiring soon" banner |

These are **demo credentials only**. Never reuse this password pattern in a
real deployment, and never seed demo data in production
(`NODE_ENV=production` already prevents it).

## 11. Known limitations (be upfront about these)

- **No real email provider is wired up.** Password reset tokens and
  invitation tokens are returned directly in the API response when
  `NODE_ENV !== 'production'`, purely so the prototype is testable
  end-to-end without external services. Before production, wire
  `authRoutes.js` and `onboardingRoutes.js` to an actual transactional email
  provider and remove the `devOnlyResetToken` / `devOnlyInviteToken` fields.
- **SQLite, not PostgreSQL, is the default in this prototype.** See section
  13 for the migration path. The schema and query style were written to
  make that migration mechanical.
- **File upload validation for the school logo is minimal** : MIME-type and
  size checks are not yet wired into a real upload endpoint (the logo input
  in the UI currently only does a client-side preview). Before production,
  add a `POST /api/school/logo` route that validates MIME type, actual file
  signature, size, and stores the file outside any web-executable path.
- **MFA is available but not enforced** for any role yet (see section 3).
- **No automated backup/restore tooling** is included. Section 14 documents
  the intended strategy; implementing scheduled backups is an operations
  task tied to your actual hosting environment.
- **Notification delivery is not implemented** : the `notifications` table
  exists in the schema but nothing currently writes to it or renders it in
  the UI. Subscription-expiry banners in the dashboards are computed live
  from subscription status rather than being pre-generated notifications.
- **Reports are the dashboard views themselves** : there isn't yet a
  separate, filterable "Reports" export/PDF area distinct from the
  dashboards. The dashboard API endpoints already support the underlying
  queries; a dedicated reports UI can be layered on top.

## 12. Installation & running locally

```bash
cd app/backend
cp .env.example .env    # edit values, especially SESSION_SECRET
npm install
npm run migrate         # applies src/db/migrations/*.sql
npm run seed             # roles/permissions + bootstrap admin + demo data
npm start                 # serves the API and the static frontend on PORT (default 4000)
```

Then open `http://localhost:4000/` in a browser. The backend also serves
the frontend directly (see `app.js`), so there is nothing separate to run
for the UI in this prototype.

## 13. Moving from SQLite to PostgreSQL

The schema in `src/db/migrations/001_init.sql` was written to translate
directly:

- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` / `BIGSERIAL`
- `TEXT` timestamp columns (ISO-8601 strings) → `TIMESTAMPTZ`, with
  `DEFAULT now()` instead of `strftime(...)`
- `CHECK (status IN (...))` constraints translate as-is
- `PRAGMA foreign_keys = ON` has no PostgreSQL equivalent (FKs are always
  enforced)

The application code accesses the database only through
`src/db/connection.js`. To swap engines: introduce a `pg` client behind the
same `db.prepare(...).get()/.all()/.run()` shape (or refactor the
repositories to use `pg`'s native query style directly : a clean refactor
opportunity given the current code is small enough to touch every call
site), point `DB_CLIENT=postgres` at your instance using the `PG_*`
variables in `.env`, and re-run the (translated) migration. No route or
service file should need business-logic changes : this was a deliberate
constraint while building the SQL layer.

## 14. Backups (strategy, not yet automated)

For PostgreSQL in production: nightly `pg_dump` to encrypted object storage,
7 daily + 4 weekly + 3 monthly retention, and a quarterly restore drill into
a scratch environment to confirm backups are actually restorable. This is
documented here as the intended approach; it is infrastructure work tied to
your actual hosting provider and is not implemented in this codebase.

## 15. Version 2 architecture notes

The schema and permission system were designed so Student, Teacher, and
Parent actors can be added without a rebuild:

- `staff.user_id` already links a staff record to an optional login account
  : a Teacher role can reuse this link rather than needing a new table.
- `students` has no `user_id` yet; adding one plus a `STUDENT` role and a
  narrow `PERMISSIONS` set (e.g. `own_academic_records.read`) is additive.
- A `PARENT` role would need a new `guardians` join table (parent user ↔
  one or more students) and permissions scoped to "read records for my
  linked students," which the existing tenant-scoping pattern in
  `schoolRoutes.js` already supports (add a `AND student.id IN (linked ids)`
  clause rather than a new authorization model).
- None of this is implemented in Version 1 by design : see the product
  README for what Version 1 actually covers.

## 16. Security considerations checklist

- [x] Passwords hashed (bcrypt in this prototype; Argon2id recommended for production)
- [x] Server-side sessions, httpOnly + SameSite cookies
- [x] Session regeneration on login
- [x] Account lockout + rate limiting on auth endpoints
- [x] RBAC enforced server-side, tested
- [x] Tenant isolation enforced server-side, tested
- [x] Subscription enforcement server-side, tested
- [x] Audit logging for sensitive actions
- [x] Parameterized queries throughout (no string-concatenated SQL)
- [x] Errors never leak stack traces to clients
- [x] Non-enumerating auth error messages
- [x] No false claims of end-to-end encryption anywhere in the product copy
- [ ] TLS/HTTPS : must be terminated by your hosting/reverse proxy; not
      something an application-layer prototype can provide on its own.
      Set `COOKIE_SECURE=true` once it's in place.
- [ ] Production email delivery (see section 11)
- [ ] File upload hardening for the school logo (see section 11)
- [ ] MFA enforcement policy for Platform Admin accounts (see section 3)

## 17. Deployment guidance (outline)

1. Provision a PostgreSQL instance; migrate the schema (section 13).
2. Set all `.env` values for production : a long random `SESSION_SECRET`,
   `COOKIE_SECURE=true`, real `PG_*` credentials, and remove
   `BOOTSTRAP_ADMIN_*` after the first Admin account is created.
3. Put the app behind a reverse proxy/load balancer that terminates TLS.
4. Run `NODE_ENV=production npm run migrate` (seed script will skip demo
   data automatically under `NODE_ENV=production`).
5. Create exactly one bootstrap Platform Admin, log in, enable MFA on that
   account, then remove the bootstrap variables from `.env`.
6. Wire a real transactional email provider for password resets and staff
   invitations (see section 11).
7. Configure your process manager (e.g. systemd, PM2) to run `npm start`
   and restart on failure; point your reverse proxy at `PORT`.
