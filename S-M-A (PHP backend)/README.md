# Academia — Multi-Tenant School Management SaaS

A production-oriented, multi-tenant school management platform.
Frontend: HTML/CSS/vanilla JS. Backend: Next.js (TypeScript) + Prisma + PostgreSQL.

This README covers **Phase 1–9** of the build (architecture, database, auth,
multi-tenancy, RBAC, dashboard). Remaining modules (students CRUD pages,
teachers, exams, fees, etc.) are built phase by phase — see **Roadmap** below.

---

## 1. Architecture

```
HTML/CSS/JS Frontend  --REST/JSON-->  Next.js API (TypeScript)  --Prisma-->  PostgreSQL
```

- The frontend is a fully static site (any host: Nginx, Vercel, Netlify). It never talks to
  the database directly — only via `fetch()` to the backend's REST API.
- Auth uses an **HTTP-only, signed session cookie** (JWT via `jose`), never `localStorage`.
- **Multi-tenancy**: every school-owned table has a `schoolId` column. `schoolId` is
  *never* trusted from the client — it is always read from the authenticated session
  (`lib/auth.ts` → `getSession()`), enforced in `middleware/tenant.middleware.ts`.
- **RBAC**: `lib/permissions.ts` defines a resource → allowed-roles matrix, enforced in
  `middleware/role.middleware.ts` at the top of every route handler.

## 2. Folder structure

```
academia-saas/
  backend/
    app/
      api/
        auth/           login, logout, me
        dashboard/      summary, attendance, student-demographics, performance
        students/       list + create (reference implementation for all other modules)
        schools/ teachers/ classes/ subjects/ attendance/ exams/ results/
        fees/ payments/ expenses/ reports/ messages/ notifications/
        events/ announcements/ timetable/     (scaffolded, phase 10+)
      layout.tsx, page.tsx
    lib/
      prisma.ts        Prisma client singleton
      auth.ts           session + password hashing
      permissions.ts     RBAC matrix
      validation.ts      Zod schemas
      response.ts        standard API response helpers
      logger.ts          audit log writer
    middleware/
      auth.middleware.ts     require a valid session
      role.middleware.ts     require a permission
      tenant.middleware.ts   resolve the trusted schoolId
    prisma/
      schema.prisma      complete data model (all 30+ tables from the spec)
      seed.ts             demo schools + users
    .env.example
  frontend/
    login.html  dashboard.html  (more pages added per phase)
    assets/
      css/  variables.css global.css layout.css dashboard.css components.css responsive.css
      js/   api.js auth.js dashboard.js utils.js
```

## 3. Database

`prisma/schema.prisma` implements every table from the spec: schools, users,
students, teachers, parents, classes, subjects, attendance, exams, results,
grading scales, fee structures, invoices, payments, receipts, expenses,
events, announcements, messages, notifications, timetables, and audit logs —
each school-owned table carries `schoolId` with proper indexes and cascade rules.

## 4. Local setup

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ (local or hosted, e.g. Neon/Supabase/Railway)

### Backend

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL and AUTH_SECRET
npm install
npm run prisma:generate
npm run prisma:migrate    # creates all tables
npm run seed               # demo schools + users
npm run dev                 # http://localhost:3000
```

### Frontend

The frontend is static — serve it with any static server, e.g.:

```bash
cd frontend
npx serve .    # or open login.html directly, or use the VS Code Live Server extension
```

Set the API URL if the backend isn't on `http://localhost:3000/api`:

```html
<!-- add before assets/js/api.js in each HTML file -->
<script>window.__API_URL__ = "https://your-api-domain.com/api";</script>
```

### Demo credentials (seeded)

| Role | Email | Password |
|---|---|---|
| Super Admin | superadmin@example.com | `Password123!` |
| School Admin | admin@example.com | `Password123!` |
| Headmaster | headmaster@example.com | `Password123!` |
| Accountant | accountant@example.com | `Password123!` |
| Teacher | teacher@example.com | `Password123!` |
| Student | student@example.com | `Password123!` |
| Parent | parent@example.com | `Password123!` |

These are **development-only** credentials — remove/rotate before production.

## 5. What's implemented in this phase

- Complete Prisma schema (all modules from the spec)
- Auth: login / logout / me, bcrypt password hashing, HTTP-only JWT session cookie
- Multi-tenancy enforcement (`requireSchoolScope`) + RBAC (`requirePermission`)
- Audit logging on login/logout/create actions
- Dashboard APIs: `/api/dashboard/summary`, `/attendance`, `/student-demographics`, `/performance` — all real, DB-driven, zero hardcoded numbers
- `Students` module as the reference CRUD implementation (list w/ pagination + search + filters, create) — the same pattern is used to build Teachers, Classes, Subjects, Exams, Fees, etc.
- Frontend: premium login page, full dashboard UI matching the reference design (sidebar, stat cards, attendance bar chart, student performance table, gender donut chart, calendar, upcoming events, user menu, dark/light theme hook, responsive down to mobile)

## 6. Roadmap (next phases)

| Phase | Scope |
|---|---|
| 10–12 | Students full CRUD UI, Teachers module, Classes & Subjects UI |
| 13–14 | Attendance marking UI, Exams & Results entry/approval, report cards (PDF) |
| 15–16 | Fees, invoices, payments (incl. Mobile Money), Expenses |
| 17 | Reports module (PDF/Excel export) |
| 18–19 | Messages, notifications, Events & Timetable |
| 20 | School settings, grading scale config |
| 21–22 | Security hardening (rate limiting, CSRF for cookie-based forms), automated tests incl. cross-tenant isolation tests |
| 23–24 | OpenAPI docs, production deployment guide |

Each phase follows the same pattern already established: Prisma model → Zod
schema → route handler (auth → RBAC → tenant scope → query) → frontend page.

## 7. Security notes

- Passwords are hashed with bcrypt (cost factor 12), never stored in plain text.
- Sessions are HTTP-only, `SameSite=Lax` cookies — never exposed to JS, never in `localStorage`.
- `schoolId` is resolved server-side from the session on every request; it is rejected if sent from the client.
- All list endpoints are paginated (`page`, `limit`, capped at 100) to prevent unbounded queries.
