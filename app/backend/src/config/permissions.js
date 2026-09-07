/**
 * Central permission catalogue.
 *
 * This is the single source of truth for RBAC. The seed script writes these
 * into the roles/permissions/role_permissions tables; the authorize()
 * middleware checks a user's resolved permission set against what a route
 * requires. Nothing in this file is enforced by itself, it only feeds the
 * database and the middleware, so a role's real power comes from what the
 * backend actually checks on each route, not from this list alone.
 */

const ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  SED: 'SED',
  HEAD_TEACHER: 'HEAD_TEACHER',
  ACCOUNTANT: 'ACCOUNTANT',
};

const PERMISSIONS = {
  // Platform (Admin) — operational visibility only, never school financials
  PLATFORM_READ: 'platform.read',
  PLATFORM_MANAGE_SCHOOLS: 'platform.manage_schools',
  PLATFORM_MANAGE_SUBSCRIPTIONS: 'platform.manage_subscriptions',
  PLATFORM_VIEW_SYSTEM_HEALTH: 'platform.view_system_health',
  PLATFORM_VIEW_SECURITY_LOGS: 'platform.view_security_logs',
  PLATFORM_MANAGE_INCIDENTS: 'platform.manage_incidents',
  PLATFORM_MANAGE_VOUCHERS: 'platform.manage_vouchers',

  // School-wide read access
  SCHOOL_READ: 'school.read',

  // Executive financial visibility (profit/surplus) — SED only
  FINANCE_READ: 'finance.read',
  PROFIT_READ: 'profit.read',
  REPORTS_READ: 'reports.read',

  // Students
  STUDENTS_READ: 'students.read',
  STUDENTS_MANAGE: 'students.manage',

  // Academics
  ACADEMICS_READ: 'academics.read',
  ACADEMICS_MANAGE: 'academics.manage',

  // Staff
  STAFF_READ: 'staff.read',
  STAFF_MANAGE: 'staff.manage',

  // Resources & infrastructure
  RESOURCES_READ: 'resources.read',
  RESOURCES_MANAGE: 'resources.manage',
  INFRASTRUCTURE_READ: 'infrastructure.read',
  INFRASTRUCTURE_MANAGE: 'infrastructure.manage',

  // Enrollment & fees
  ENROLLMENT_MANAGE: 'enrollment.manage',
  FEES_READ: 'fees.read',
  FEES_MANAGE: 'fees.manage',
  PAYMENTS_MANAGE: 'payments.manage',

  // Expenses
  EXPENSES_READ: 'expenses.read',
  EXPENSES_MANAGE: 'expenses.manage',

  // School-level staff/role administration (invitations)
  SCHOOL_USERS_MANAGE: 'school_users.manage',
};

const ROLE_PERMISSIONS = {
  [ROLES.PLATFORM_ADMIN]: [
    PERMISSIONS.PLATFORM_READ,
    PERMISSIONS.PLATFORM_MANAGE_SCHOOLS,
    PERMISSIONS.PLATFORM_MANAGE_SUBSCRIPTIONS,
    PERMISSIONS.PLATFORM_VIEW_SYSTEM_HEALTH,
    PERMISSIONS.PLATFORM_VIEW_SECURITY_LOGS,
    PERMISSIONS.PLATFORM_MANAGE_INCIDENTS,
    PERMISSIONS.PLATFORM_MANAGE_VOUCHERS,
  ],
  [ROLES.SED]: [
    PERMISSIONS.SCHOOL_READ,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.PROFIT_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.STAFF_READ,
    PERMISSIONS.ACADEMICS_READ,
    PERMISSIONS.RESOURCES_READ,
    PERMISSIONS.INFRASTRUCTURE_READ,
    PERMISSIONS.EXPENSES_READ,
    PERMISSIONS.FEES_READ,
    PERMISSIONS.SCHOOL_USERS_MANAGE,
  ],
  [ROLES.HEAD_TEACHER]: [
    PERMISSIONS.SCHOOL_READ,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.ACADEMICS_READ,
    PERMISSIONS.ACADEMICS_MANAGE,
    PERMISSIONS.STAFF_READ,
    PERMISSIONS.RESOURCES_READ,
    PERMISSIONS.INFRASTRUCTURE_READ,
    PERMISSIONS.INFRASTRUCTURE_MANAGE,
    PERMISSIONS.EXPENSES_READ,
  ],
  [ROLES.ACCOUNTANT]: [
    PERMISSIONS.SCHOOL_READ,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.ENROLLMENT_MANAGE,
    PERMISSIONS.FEES_READ,
    PERMISSIONS.FEES_MANAGE,
    PERMISSIONS.PAYMENTS_MANAGE,
    PERMISSIONS.EXPENSES_READ,
    PERMISSIONS.EXPENSES_MANAGE,
    PERMISSIONS.STAFF_READ,
    PERMISSIONS.STAFF_MANAGE,
  ],
};

module.exports = { ROLES, PERMISSIONS, ROLE_PERMISSIONS };
