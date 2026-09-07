-- The School Management App - initial schema (SQLite)
-- Column choices intentionally mirror what a PostgreSQL migration would look
-- like (UUID-style public ids as TEXT, ISO-8601 timestamps as TEXT, explicit
-- status enums as CHECK constraints) so moving to PostgreSQL later is a
-- mechanical translation. See docs/README-internal.md.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Platform: schools (tenants)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id       TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    logo_path       TEXT,
    status          TEXT NOT NULL DEFAULT 'trial'
                    CHECK (status IN ('trial','active','expiring_soon','expired','grace_period','frozen','suspended','cancelled')),
    trial_ends_at   TEXT,
    subscription_ends_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Users, roles, permissions (RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id       TEXT UNIQUE NOT NULL,
    school_id       INTEGER REFERENCES schools(id) ON DELETE CASCADE, -- NULL for platform admins
    username        TEXT NOT NULL,
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
    mfa_secret      TEXT,
    mfa_enabled     INTEGER NOT NULL DEFAULT 0,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,
    last_login_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(school_id, email),
    UNIQUE(school_id, username)
);
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);

CREATE TABLE IF NOT EXISTS roles (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT UNIQUE NOT NULL -- PLATFORM_ADMIN, SED, HEAD_TEACHER, ACCOUNTANT
);

CREATE TABLE IF NOT EXISTS permissions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    key     TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------------
-- Onboarding: invitations and password reset tokens
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id    TEXT UNIQUE NOT NULL,
    school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    role_id      INTEGER NOT NULL REFERENCES roles(id),
    token_hash   TEXT NOT NULL,
    invited_by   INTEGER REFERENCES users(id),
    expires_at   TEXT NOT NULL,
    used_at      TEXT,
    revoked_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Academic domain
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id      INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,          -- e.g. "Form 2", "Standard 5"
    education_level TEXT,                  -- primary / secondary
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);

CREATE TABLE IF NOT EXISTS subjects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id);

CREATE TABLE IF NOT EXISTS students (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id       TEXT UNIQUE NOT NULL,
    school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    admission_no    TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    class_id        INTEGER REFERENCES classes(id),
    gender          TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','graduated','withdrawn')),
    enrolled_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(school_id, admission_no)
);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);

CREATE TABLE IF NOT EXISTS staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id   TEXT UNIQUE NOT NULL,
    school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id),
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    position    TEXT NOT NULL,     -- Teacher, Bursar clerk, Support staff, etc.
    is_teacher  INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    hired_at    TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_school ON staff(school_id);

CREATE TABLE IF NOT EXISTS academic_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_id    INTEGER REFERENCES classes(id),
    term        TEXT NOT NULL,      -- e.g. "Term 1"
    year        INTEGER NOT NULL,
    score       REAL NOT NULL,
    grade       TEXT,
    recorded_by INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_academic_school ON academic_records(school_id);
CREATE INDEX IF NOT EXISTS idx_academic_student ON academic_records(student_id);

-- ---------------------------------------------------------------------
-- Financial domain
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fees (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id     TEXT UNIQUE NOT NULL,
    school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    term          TEXT NOT NULL,
    year          INTEGER NOT NULL,
    amount_due    REAL NOT NULL,
    amount_paid   REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','waived')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fees_school ON fees(school_id);
CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id);

CREATE TABLE IF NOT EXISTS payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id     TEXT UNIQUE NOT NULL,
    school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    fee_id        INTEGER NOT NULL REFERENCES fees(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES students(id),
    amount        REAL NOT NULL,
    method        TEXT NOT NULL DEFAULT 'cash',
    status        TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
    reversed_reason TEXT,
    recorded_by   INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id);

CREATE TABLE IF NOT EXISTS expense_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,          -- e.g. Water, Electricity, Maintenance, Supplies, Infrastructure
    kind        TEXT NOT NULL DEFAULT 'operational' CHECK (kind IN ('operational','resource','infrastructure')),
    UNIQUE(school_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id     TEXT UNIQUE NOT NULL,
    school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    category_id   INTEGER NOT NULL REFERENCES expense_categories(id),
    project_id    INTEGER REFERENCES infrastructure_projects(id),
    description   TEXT NOT NULL,
    amount        REAL NOT NULL,
    status        TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided')),
    voided_reason TEXT,
    incurred_on   TEXT NOT NULL,
    recorded_by   INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_school ON expenses(school_id);

CREATE TABLE IF NOT EXISTS infrastructure_projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id   TEXT UNIQUE NOT NULL,
    school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','on_hold')),
    budget      REAL NOT NULL DEFAULT 0,
    start_date  TEXT,
    end_date    TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_school ON infrastructure_projects(school_id);

-- ---------------------------------------------------------------------
-- Subscriptions and vouchers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plan        TEXT NOT NULL DEFAULT 'standard',
    status      TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expiring_soon','expired','grace_period','frozen','suspended','cancelled')),
    started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ends_at     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_school ON subscriptions(school_id);

CREATE TABLE IF NOT EXISTS vouchers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id     TEXT UNIQUE NOT NULL,
    code_hash     TEXT NOT NULL,
    school_id     INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    duration_days INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','activated','expired','revoked')),
    issued_by     INTEGER REFERENCES users(id),
    issued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    activated_at  TEXT,
    expires_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_vouchers_school ON vouchers(school_id);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id   INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    message     TEXT NOT NULL,
    read_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- ---------------------------------------------------------------------
-- Audit logging, security events, incidents
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id   INTEGER REFERENCES users(id),
    actor_role      TEXT,
    school_id       INTEGER REFERENCES schools(id),
    action          TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    previous_value  TEXT,
    new_value       TEXT,
    result          TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','denied','error')),
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS security_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,     -- failed_login, account_locked, permission_denied, ...
    user_id     INTEGER REFERENCES users(id),
    school_id   INTEGER REFERENCES schools(id),
    ip_address  TEXT,
    detail      TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);

CREATE TABLE IF NOT EXISTS incidents (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id         TEXT UNIQUE NOT NULL,
    title             TEXT NOT NULL,
    severity          TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    affected_service  TEXT,
    affected_school_id INTEGER REFERENCES schools(id),
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','mitigated','resolved','closed')),
    detected_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at       TEXT,
    responsible_admin INTEGER REFERENCES users(id),
    notes             TEXT
);
