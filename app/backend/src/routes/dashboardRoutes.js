const express = require('express');
const db = require('../db/connection');
const subscriptionService = require('../services/subscriptionService');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireSchoolContext } = require('../middleware/tenant');
const { PERMISSIONS } = require('../config/permissions');

const router = express.Router();

// -----------------------------------------------------------------------
// Platform Admin dashboard — aggregate, non-financial platform metrics only.
// -----------------------------------------------------------------------
router.get('/admin', requireAuth, requirePermission(PERMISSIONS.PLATFORM_READ), (req, res) => {
  const totalSchools = db.prepare('SELECT COUNT(*) AS n FROM schools').get().n;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM schools GROUP BY status').all();
  const totalStudents = db.prepare('SELECT COUNT(*) AS n FROM students').get().n;
  const totalStaff = db.prepare('SELECT COUNT(*) AS n FROM staff WHERE status = ?').get('active').n;

  const growth = db.prepare(`
    SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n FROM schools
    GROUP BY month ORDER BY month
  `).all();

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentErrors = db.prepare('SELECT COUNT(*) AS n FROM security_events WHERE created_at >= ?').get(since).n;
  const openIncidents = db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE status NOT IN (?, ?)')
    .get('resolved', 'closed').n;

  res.json({
    totalSchools, byStatus, totalStudents, totalStaff, schoolGrowth: growth,
    recentErrors7d: recentErrors, openIncidents,
  });
});

// -----------------------------------------------------------------------
// SED dashboard — executive overview including profit/surplus.
// -----------------------------------------------------------------------
router.get('/sed', requireAuth, requireSchoolContext, requirePermission(PERMISSIONS.FINANCE_READ, PERMISSIONS.PROFIT_READ), (req, res) => {
  const schoolId = req.schoolId;

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p
    WHERE p.school_id = ? AND p.status = 'completed'
  `).get(schoolId).total;

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE school_id = ? AND status = 'recorded'
  `).get(schoolId).total;

  const monthlyRevenue = db.prepare(`
    SELECT substr(created_at, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
    FROM payments WHERE school_id = ? AND status = 'completed' GROUP BY month ORDER BY month
  `).all(schoolId);

  const monthlyExpenses = db.prepare(`
    SELECT substr(incurred_on, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE school_id = ? AND status = 'recorded' GROUP BY month ORDER BY month
  `).all(schoolId);

  const resourceSpend = db.prepare(`
    SELECT c.name, COALESCE(SUM(e.amount), 0) AS total
    FROM expense_categories c LEFT JOIN expenses e ON e.category_id = c.id AND e.status = 'recorded'
    WHERE c.school_id = ? AND c.kind = 'resource' GROUP BY c.id
  `).all(schoolId);

  const projects = db.prepare(`
    SELECT status, COUNT(*) AS n FROM infrastructure_projects WHERE school_id = ? GROUP BY status
  `).all(schoolId);

  const studentCount = db.prepare('SELECT COUNT(*) AS n FROM students WHERE school_id = ? AND status = ?').get(schoolId, 'active').n;
  const staffCount = db.prepare('SELECT COUNT(*) AS n FROM staff WHERE school_id = ? AND status = ?').get(schoolId, 'active').n;
  const outstandingFees = db.prepare(`
    SELECT COALESCE(SUM(amount_due - amount_paid), 0) AS total FROM fees WHERE school_id = ? AND status != 'paid'
  `).get(schoolId).total;

  res.json({
    revenue, expenses, profit: revenue - expenses,
    monthlyRevenue, monthlyExpenses, resourceSpend, projects,
    studentCount, staffCount, outstandingFees,
  });
});

// -----------------------------------------------------------------------
// Head Teacher dashboard — academic and operational, no profit figures.
// -----------------------------------------------------------------------
router.get('/head-teacher', requireAuth, requireSchoolContext, requirePermission(PERMISSIONS.ACADEMICS_READ), (req, res) => {
  const schoolId = req.schoolId;

  const studentCount = db.prepare('SELECT COUNT(*) AS n FROM students WHERE school_id = ? AND status = ?').get(schoolId, 'active').n;
  const teacherCount = db.prepare('SELECT COUNT(*) AS n FROM staff WHERE school_id = ? AND is_teacher = 1 AND status = ?')
    .get(schoolId, 'active').n;

  const subjectPerformance = db.prepare(`
    SELECT sub.name AS subject, ROUND(AVG(ar.score), 1) AS average, COUNT(*) AS n
    FROM academic_records ar JOIN subjects sub ON sub.id = ar.subject_id
    WHERE ar.school_id = ? GROUP BY sub.id ORDER BY sub.name
  `).all(schoolId);

  const classPerformance = db.prepare(`
    SELECT c.name AS class, ROUND(AVG(ar.score), 1) AS average, COUNT(*) AS n
    FROM academic_records ar
    JOIN students s ON s.id = ar.student_id
    JOIN classes c ON c.id = s.class_id
    WHERE ar.school_id = ? GROUP BY c.id ORDER BY c.name
  `).all(schoolId);

  const annualTrend = db.prepare(`
    SELECT year, ROUND(AVG(score), 1) AS average FROM academic_records
    WHERE school_id = ? GROUP BY year ORDER BY year
  `).all(schoolId);

  const resourceExpenses = db.prepare(`
    SELECT c.name, COALESCE(SUM(e.amount), 0) AS total
    FROM expense_categories c LEFT JOIN expenses e ON e.category_id = c.id AND e.status = 'recorded'
    WHERE c.school_id = ? AND c.kind IN ('resource', 'infrastructure') GROUP BY c.id
  `).all(schoolId);

  const projects = db.prepare(`
    SELECT public_id, name, status, budget FROM infrastructure_projects WHERE school_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(schoolId);

  res.json({ studentCount, teacherCount, subjectPerformance, classPerformance, annualTrend, resourceExpenses, projects });
});

// -----------------------------------------------------------------------
// Accountant dashboard — financial and administrative operations.
// -----------------------------------------------------------------------
router.get('/accountant', requireAuth, requireSchoolContext, requirePermission(PERMISSIONS.FEES_READ), (req, res) => {
  const schoolId = req.schoolId;

  const collected = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE school_id = ? AND status = 'completed'
  `).get(schoolId).total;

  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(amount_due - amount_paid), 0) AS total FROM fees WHERE school_id = ? AND status != 'paid'
  `).get(schoolId).total;

  const collectionTrend = db.prepare(`
    SELECT substr(created_at, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
    FROM payments WHERE school_id = ? AND status = 'completed' GROUP BY month ORDER BY month
  `).all(schoolId);

  const expenseTrend = db.prepare(`
    SELECT substr(incurred_on, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE school_id = ? AND status = 'recorded' GROUP BY month ORDER BY month
  `).all(schoolId);

  const feesByStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM fees WHERE school_id = ? GROUP BY status
  `).all(schoolId);

  const recentPayments = db.prepare(`
    SELECT pmt.public_id, s.first_name, s.last_name, pmt.amount, pmt.method, pmt.status, pmt.created_at
    FROM payments pmt JOIN students s ON s.id = pmt.student_id
    WHERE pmt.school_id = ? ORDER BY pmt.created_at DESC LIMIT 10
  `).all(schoolId);

  const enrollmentThisYear = db.prepare(`
    SELECT COUNT(*) AS n FROM students WHERE school_id = ? AND substr(enrolled_at, 1, 4) = strftime('%Y', 'now')
  `).get(schoolId).n;

  res.json({ collected, outstanding, collectionTrend, expenseTrend, feesByStatus, recentPayments, enrollmentThisYear });
});

// Subscription/service status — visible to any authenticated school user
// (used for the "service expiring" banner across every dashboard).
router.get('/service-status', requireAuth, requireSchoolContext, (req, res) => {
  const sub = subscriptionService.getActiveSubscription(req.schoolId);
  const status = subscriptionService.computeStatus(sub);
  res.json({ status, endsAt: sub ? sub.ends_at : null, schoolName: req.school.name });
});

module.exports = router;
