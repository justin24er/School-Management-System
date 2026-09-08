# The School Management App — Internal / Developer Documentation

This document describes what is actually implemented in this codebase. It is
for internal admin, developer, and preview use only. Do not distribute this
document to customers — see `README-product.md` for the public-facing
version.

## 0. Recent fixes and additions (read this first)

**Second pass — deeper bugs found after the first "fix":**

- **Fixed: charts growing downward, overflowing the page.** Every chart is
  created with `maintainAspectRatio: false`, which means Chart.js sizes the
  canvas to fill its *immediate parent's* box. The canvases had no such
  parent — they sat directly in a `.panel` with `height: auto`, creating a
  circular dependency (canvas height depends on parent height, parent
  height depends on canvas content, each render nudges it taller). Fixed
  by wrapping every `<canvas>` in a `.chart-box` div with a fixed CSS
  height (`dashboard.css`) — the standard, documented Chart.js pattern for
  responsive charts. If you add a new chart, wrap its canvas in
  `<div class="chart-box"><canvas ...></canvas></div>` too, or it will
  have the same bug.
- **Fixed: dark mode text was unreadable / button text broke.** Two
  separate root causes, both the same class of mistake: `--full-white` and
  `--silent-white` (in `dashboard.css`) and `--full-white` (in `auth.css`)
  are each used for two different jobs — sometimes as a page/card
  *surface* color that should flip dark, and sometimes as literal white
  *foreground text* on a permanently-colored element (button text, the
  avatar circle, the status card, the show-password checkmark) that must
  stay light in both themes. The previous pass remapped these variables
  wholesale, which fixed backgrounds but broke every "must stay white"
  foreground use — e.g. button text going dark-on-dark. Fixed by adding a
  dedicated `--on-accent` token (`dashboard.css`) for foreground-on-brand-
  color text that never changes with theme, and by never remapping
  `--full-white` in the auth pages at all — only `--silent-white`, plus
  explicit selector overrides for the specific surfaces that need to go
  dark. `auth.css` also never set a base text `color` on `body`, so
  headings/labels were plain black regardless of theme; that's fixed with
  an explicit `color` on `.registration-section`/`.login-section` in dark
  mode (auth-overrides.css), which the rest of the text inherits.
  **The lesson for any new dark-mode CSS in this project:** before reusing
  an existing variable inside `[data-theme="dark"]`, grep every usage of
  it first (`grep -n "var(--the-name)" *.css`) and check whether any of
  them are "light text on a colored button/badge" — those must use
  `--on-accent` instead, never the surface variable.
- **Fixed: the Accountant's "Record an expense" form looked unstyled.**
  Its `.field` divs live outside any `.modal`, but the styling rules were
  scoped to `.modal .field` only, so those inputs/selects got zero custom
  styling (raw browser defaults). Made `.field` a standalone rule so it
  styles correctly everywhere, and added proper labels to that form
  (it previously only had placeholder text, no `<label>`, unlike every
  other form in the app).
- **Added:** general visual polish on the login/trial page — a warmer
  layered shadow instead of the flat grey default, a gentle entrance
  animation, and real `:focus` states on inputs (previously none existed).

**First pass — earlier fixes and additions, still in effect:**

- **Fixed:** `classes`, `subjects`, and `expense_categories` tables were
  missing a `public_id` column that the API code assumed existed. This
  silently broke loading/creating classes, subjects, and expense
  categories — including the "Add student" class dropdown and the
  Accountant's "Record an expense" category dropdown. Fixed in the schema
  and all six insert sites (see section 5).
- **Fixed:** Chart.js threw "Canvas is already in use" after adding a
  student, recording a payment, or recording an expense, because dashboards
  redraw their charts on every data refresh without destroying the previous
  chart instance first. Fixed with a shared `renderChart()` helper in
  `dashboard-shell.js` used by all four dashboards.
- **Fixed:** the "Add student" form had no way to assign a class. Added.
- **Added:** dark mode, toggled from a button in the top-right of every
  page (dashboards and the login/invite/reset pages), persisted in
  `localStorage`, applied before first paint to avoid a flash of the wrong
  theme.
- **Added:** full responsive layout. The right-hand rail (voucher panel,
  service status, etc.) now reflows below the main content on tablet-width
  screens instead of disappearing; charts no longer overflow when the
  window shrinks and get stuck that way when it grows back; long text
  (voucher codes, status messages) wraps instead of overflowing its card.
- **Added:** animated modal open/close (scale + fade) across all three
  modals (Add Student, Record Payment, School detail), instead of an
  instant, static show/hide.
- **Added:** search and filter on the Head Teacher's Students table — a
  debounced search box (name or admission number) plus Class and Status
  filter dropdowns. Backed by a new `classId` query parameter on
  `GET /api/school/students` (search and status filtering already existed).

## 1. Architecture overview

```
frontend (static HTML/CSS/vanilla JS)
        |
        v
backend API (Node.js / Express)
        |
        v
SQLite (development/prototype) — swappable to PostgreSQL for production
```

The frontend never talks to the database directly and never makes an
authorization decision that matters — every permission, tenant-ownership,
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
      css/
        auth.css                 Original template, untouched
        auth-overrides.css       Additive: single-column school-name, MFA field,
                                  dark mode overrides for the auth pages
        dashboard.css             Full dashboard shell: layout, dark mode, responsive
                                  breakpoints, modal animation, filter bar
      js/
        api.js                    Fetch wrapper (401 handling, credentials)
        theme.js                  Standalone dark-mode toggle for the auth pages
        dashboard-shell.js        Shared shell: nav, session guard, renderChart(),
                                  openModal()/closeModal(), theme toggle
        auth.js                   Login / trial-signup page logic
        admin.js, sed.js, head-teacher.js, accountant.js   One per dashboard
        vendor/chart.umd.js       Chart.js, served locally (no CDN dependency)
    pages/dashboards/
      admin.html, sed.html, head-teacher.html, accountant.html
  docs/
    README-product.md          Public documentation
    README-internal.md          This file
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
  provider is wired up in this prototype — see section 11).
- TOTP-based MFA is implemented (`otplib`) and available to any account via
  `/api/auth/mfa/setup` and `/api/auth/mfa/enable`. It is not force-enabled
  for any role in this prototype.

## 4. Authorization (RBAC)

`src/config/permissions.js` is the single source of truth for roles and
permissions. `src/db/seed.js` writes this into the `roles`, `permissions`,
and `role_permissions` tables. `src/middleware/auth.js` resolves a logged-in
user's roles and permission set from the database on every request
(`attachUser`), and `requirePermission(...)` / `requireRole(...)` enforce it
on each route. A denied check is written to `audit_logs`.

| Role | Key permissions | Notably NOT permitted |
|---|---|---|
| PLATFORM_ADMIN | platform.read, platform.manage_schools, platform.manage_subscriptions, platform.manage_vouchers, platform.view_system_health, platform.view_security_logs, platform.manage_incidents | Any school financial data (fees, payments, expenses, profit) — the admin router does not join those tables at all |
| SED | school.read, finance.read, profit.read, reports.read, students.read, staff.read, academics.read, resources.read, infrastructure.read, expenses.read, fees.read, school_users.manage | students.manage, staff.manage, expenses.manage, infrastructure.manage (SED is read-only + can invite staff, by design) |
| HEAD_TEACHER | students.read/manage, academics.read/manage, staff.read, resources.read, infrastructure.read/manage, expenses.read | finance.read, profit.read (no profit visibility) |
| ACCOUNTANT | students.read, enrollment.manage, fees.read/manage, payments.manage, expenses.read/manage, staff.read/manage | infrastructure.manage, profit.read, finance.read |

## 5. Data model notes: public IDs

Every table that's addressable through the API (students, staff, fees,
payments, expenses, classes, subjects, expense_categories, infrastructure
projects, invitations, vouchers, incidents, schools, users) has both an
internal integer `id` (used only inside the database, never exposed) and a
`public_id` text column (a random, prefixed string like `stu_...`,
`cls_...`, `cat_...`, generated by `src/utils/ids.js`'s `publicId()`).
**Every new table you add needs both**, and every `INSERT` needs to
generate and store a `public_id` — the bug described in section 0 was
exactly this being missed for three tables. If a route ever throws
`no such column: public_id` or `no such column: X`, check the table's
`CREATE TABLE` statement in `001_init.sql` against what the route is
actually selecting/inserting.

## 6. Multi-tenancy

Every school is a tenant. `src/middleware/tenant.js`'s
`requireSchoolContext` resolves `req.schoolId` **exclusively from the
authenticated session** (`req.user.schoolId`), never from a URL parameter,
header, or request body. Every school-scoped query in `schoolRoutes.js` and
`dashboardRoutes.js` filters by `req.schoolId`. A request for a resource
belonging to another school returns 404, not 403 — the resource simply does
not exist within the caller's tenant scope.

## 7. Subscription lifecycle

`src/services/subscriptionService.js` is the single authority for a
school's subscription status: `trial → active → expiring_soon →
grace_period → expired`, with `frozen`/`suspended`/`cancelled` as
Admin-controlled states. Status is computed from `subscriptions.ends_at`
and re-derived by `src/middleware/tenant.js`'s `enforceSubscriptionForWrites`
(blocks writes once a school's status no longer allows them) and
`src/jobs/subscriptionSweep.js` (hourly sweep, persists transitions, writes
an audit log entry for each one).

## 8. Vouchers

Vouchers are issued by a Platform Admin (`POST /api/admin/vouchers`) as a
random token; only its SHA-256 hash is stored. Redeeming a voucher
(`POST /api/admin/vouchers/redeem`) extends a school's subscription by the
voucher's `duration_days`, calculated **entirely server-side**. The client
only ever supplies a voucher code and a school id — never a duration.

## 9. Audit logging & security events

`src/services/auditService.js` writes to `audit_logs` (business actions)
and `security_events` (authentication-adjacent events). Neither table is
ever written with a password, token, or other secret value.
`GET /api/admin/audit-logs` and `GET /api/admin/security-events` expose
these to Platform Admins holding `platform.view_security_logs`.

## 10. Frontend architecture notes

- **Dark mode**: a `data-theme` attribute on `<html>`, toggled by a button
  with id `theme-toggle`, persisted under the `sma-theme` localStorage key.
  `dashboard-shell.js`'s `getTheme()`/`setTheme()`/`initThemeToggle()` power
  the four dashboards; `theme.js` is the same logic standalone for the
  three auth-flow pages, so both sets of pages share one preference. Every
  page's `<head>` has a small inline script that applies the saved theme
  before first paint, to avoid a flash of the wrong theme.
- **Charts**: always go through `renderChart(key, ctx, config)` in
  `dashboard-shell.js`, never call `new Chart(...)` directly — it tracks
  instances by key and destroys the previous one before creating a new one
  on the same canvas. `config.options` is merged with
  `{ responsive: true, maintainAspectRatio: false }` by default.
- **Modals**: always use `openModal(backdropEl)` / `closeModal(backdropEl)`
  from `dashboard-shell.js` rather than toggling the `show` class directly
  — `closeModal` adds a `closing` class (which CSS animates out) and only
  removes `show` after the animation's `MODAL_CLOSE_MS` (180ms) via
  `setTimeout`, matching the CSS `@keyframes modal-out` duration in
  `dashboard.css`. If you add a new modal, follow this pattern and give the
  animation timing in JS and CSS the same value if you change it.
- **Responsive layout**: `.app-shell` is a CSS grid using named areas
  (`sidebar`/`main`/`rail`). Below 1100px, the areas are redefined so
  `rail` sits in its own row below `main`, full width, rather than being
  hidden — this is what fixed the voucher panel disappearing on tablet.
  `min-width: 0` is set on grid/flex children throughout, which is what
  lets panels (and the charts inside them) actually shrink with their
  track instead of overflowing and staying overflowed.

## 11. Testing

```bash
cd app/backend
npm install
npm test
```

Runs `src/tests/api.test.js` against a real, temporary SQLite database and
a real running instance of the Express app. Covers:

| Actor | Action | Expected |
|---|---|---|
| SED | Read own dashboard incl. profit | Allowed |
| Head Teacher | Read SED profit dashboard | Denied (403) |
| Accountant | Create infrastructure project | Denied (403) |
| Accountant | Record a payment | Allowed (201) |
| School user (any role) | Reach a platform admin route | Denied (403) |
| Platform Admin | List schools | Allowed, no financial fields in the response |
| School B user | Read School A's students | Returns School B's own data only |
| School B user | Record a payment against a School A fee id | Denied (404) |
| Expired school user | Read own records | Allowed |
| Expired school user | Create a staff record (write) | Denied (402) |
| Any account | 5 failed logins, then a 6th (even correct) attempt | Locked (423) |
| Trial signup | Submit `role: "PLATFORM_ADMIN"` in the request body | Ignored — SED only |

When adding a frontend feature that touches a new or existing table,
also run the two structural checks used while building this pass, since
they catch exactly the two bug classes seen in section 0:

```bash
# JS syntax check
for f in app/frontend/public/js/*.js; do node --check "$f"; done

# HTML well-formedness check (catches unclosed/mismatched tags)
python3 -c "
from html.parser import HTMLParser
import glob
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class C(HTMLParser):
    def __init__(self): super().__init__(); self.stack=[]
    def handle_starttag(self,t,a):
        if t not in VOID: self.stack.append(t)
    def handle_endtag(self,t):
        if t in VOID: return
        if self.stack and self.stack[-1]==t: self.stack.pop()
        elif t in self.stack:
            while self.stack and self.stack[-1]!=t: self.stack.pop()
            if self.stack: self.stack.pop()
for f in glob.glob('app/frontend/public/*.html')+glob.glob('app/frontend/pages/dashboards/*.html'):
    c=C(); c.feed(open(f).read())
    print(f, 'OK' if not c.stack else f'UNCLOSED: {c.stack}')
"
```

## 12. Demo accounts

**Platform Admin** (from `.env`'s `BOOTSTRAP_ADMIN_EMAIL`/`PASSWORD`):
created only if no Admin account exists yet.

**Two demo schools** (non-production only), password `DemoPass!2026` for
every demo account:

| School | SED | Head Teacher | Accountant | Notes |
|---|---|---|---|---|
| Uwezo Secondary School (Demo) | sed@uwezo.demo | headteacher@uwezo.demo | accountant@uwezo.demo | Active subscription, ~300 days remaining |
| Amani Primary School (Demo) | sed@amani.demo | headteacher@amani.demo | accountant@amani.demo | Expiring in ~12 days — shows the "expiring soon" banner |

## 13. Known limitations

- No real email provider is wired up — reset/invite tokens are dev-only in
  the API response when `NODE_ENV !== 'production'`.
- SQLite, not PostgreSQL, is the default (see section 14 for the migration
  path).
- School logo upload is client-side preview only; no server-side
  validation/storage endpoint yet.
- MFA is available but not enforced for any role.
- No automated backup/restore tooling.
- Notifications table exists but nothing writes to or renders it yet.
- No dedicated filterable "Reports" export view distinct from the
  dashboards themselves.
- The sidebar nav links other than "Dashboard" (Students, Teachers,
  Academics, Infrastructure, Finance, etc.) are anchor placeholders on the
  single dashboard page for that role — they don't yet navigate to separate
  sub-pages.
- Search/filter (section 0) is implemented on the Head Teacher's Students
  table only; the same pattern (search box + relevant filters, debounced,
  backed by query params already supported or easy to add server-side)
  can be extended to Staff, Fees, Payments, and Expenses tables the same
  way.

## 14. Installation & running locally

```bash
cd app/backend
cp .env.example .env    # edit values, especially SESSION_SECRET
npm install
npm run migrate         # applies src/db/migrations/*.sql
npm run seed             # roles/permissions + bootstrap admin + demo data
npm start                 # serves the API and the static frontend on PORT (default 4000)
```

Then open `http://localhost:4000/`.

## 15. Moving from SQLite to PostgreSQL

- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` / `BIGSERIAL`
- `TEXT` timestamp columns (ISO-8601 strings) → `TIMESTAMPTZ`, `DEFAULT now()`
- `CHECK (status IN (...))` constraints translate as-is
- `PRAGMA foreign_keys = ON` has no PostgreSQL equivalent (always enforced)

The application only touches the database through `src/db/connection.js`,
so swapping engines means introducing a `pg`-backed equivalent there (or
refactoring call sites to `pg`'s native query style) and re-running a
translated migration. No route or service file should need business-logic
changes.

## 16. Deployment guidance (outline)

1. Provision PostgreSQL; migrate the schema (section 15).
2. Set production `.env` values — long random `SESSION_SECRET`,
   `COOKIE_SECURE=true`, real `PG_*` credentials; remove `BOOTSTRAP_ADMIN_*`
   after the first Admin account is created.
3. Put the app behind a TLS-terminating reverse proxy.
4. `NODE_ENV=production npm run migrate` (seed skips demo data automatically).
5. Create one bootstrap Platform Admin, log in, enable MFA, then remove the
   bootstrap variables from `.env`.
6. Wire a real transactional email provider (section 13).
7. Run `npm start` under a process manager (systemd, PM2) with
   restart-on-failure.
