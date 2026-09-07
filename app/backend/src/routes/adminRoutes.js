const express = require('express');
const Joi = require('joi');
const db = require('../db/connection');
const { publicId } = require('../utils/ids');
const passwords = require('../utils/passwords');
const auditService = require('../services/auditService');
const subscriptionService = require('../services/subscriptionService');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validateBody } = require('../utils/validate');
const { PERMISSIONS } = require('../config/permissions');

const router = express.Router();
router.use(requireAuth);

// Every route below requires an explicit platform.* permission. Platform
// Admin routes deliberately never join into fees/payments/expenses tables —
// school financial data is not reachable from this router at all (spec
// section 7/28), not merely hidden from the UI.

router.get('/schools', requirePermission(PERMISSIONS.PLATFORM_READ), (req, res) => {
  const rows = db.prepare(`
    SELECT sc.public_id, sc.name, sc.status, sc.trial_ends_at, sc.subscription_ends_at, sc.created_at,
           (SELECT COUNT(*) FROM users u WHERE u.school_id = sc.id) AS user_count,
           (SELECT COUNT(*) FROM students st WHERE st.school_id = sc.id) AS student_count,
           (SELECT COUNT(*) FROM staff sf WHERE sf.school_id = sc.id AND sf.status = 'active') AS staff_count
    FROM schools sc ORDER BY sc.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/schools/summary', requirePermission(PERMISSIONS.PLATFORM_READ), (req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM schools GROUP BY status').all();
  const total = db.prepare('SELECT COUNT(*) AS n FROM schools').get().n;
  res.json({ total, byStatus });
});

router.get('/schools/:publicId', requirePermission(PERMISSIONS.PLATFORM_READ), (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE public_id = ?').get(req.params.publicId);
  if (!school) return res.status(404).json({ error: 'School not found.' });

  const subscription = subscriptionService.getActiveSubscription(school.id);
  const users = db.prepare('SELECT public_id, username, status, last_login_at FROM users WHERE school_id = ?').all(school.id);
  const recentErrors = db.prepare(`
    SELECT type, detail, created_at FROM security_events WHERE school_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(school.id);
  const voucherHistory = db.prepare(`
    SELECT public_id, duration_days, status, issued_at, activated_at, expires_at FROM vouchers
    WHERE school_id = ? ORDER BY issued_at DESC
  `).all(school.id);

  res.json({
    school: {
      publicId: school.public_id, name: school.name, status: school.status,
      trialEndsAt: school.trial_ends_at, subscriptionEndsAt: school.subscription_ends_at,
      createdAt: school.created_at,
    },
    subscription,
    users,
    recentSecurityEvents: recentErrors,
    voucherHistory,
    // Deliberately no fee/payment/expense figures here — see note above.
  });
});

router.post('/schools/:publicId/freeze', requirePermission(PERMISSIONS.PLATFORM_MANAGE_SCHOOLS), validateBody(Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
})), (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE public_id = ?').get(req.params.publicId);
  if (!school) return res.status(404).json({ error: 'School not found.' });

  db.prepare('UPDATE schools SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run('frozen', school.id);
  db.prepare('UPDATE subscriptions SET status = ? WHERE school_id = ?').run('frozen', school.id);

  auditService.record({
    actorUserId: req.user.id, actorRole: 'PLATFORM_ADMIN', schoolId: school.id, action: 'school.frozen',
    resourceId: school.public_id, previousValue: { status: school.status }, newValue: { status: 'frozen', reason: req.body.reason },
  });
  res.json({ message: 'School has been frozen.' });
});

router.post('/schools/:publicId/unfreeze', requirePermission(PERMISSIONS.PLATFORM_MANAGE_SCHOOLS), validateBody(Joi.object({
  extendDays: Joi.number().integer().min(1).max(365).required(),
})), (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE public_id = ?').get(req.params.publicId);
  if (!school) return res.status(404).json({ error: 'School not found.' });

  const newEndsAt = new Date(Date.now() + req.body.extendDays * 24 * 60 * 60 * 1000).toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE schools SET status = ?, subscription_ends_at = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
      .run('active', newEndsAt, school.id);
    db.prepare('UPDATE subscriptions SET status = ?, ends_at = ? WHERE school_id = ?')
      .run('active', newEndsAt, school.id);
  });
  tx();

  auditService.record({
    actorUserId: req.user.id, actorRole: 'PLATFORM_ADMIN', schoolId: school.id, action: 'school.unfrozen',
    resourceId: school.public_id, previousValue: { status: school.status }, newValue: { status: 'active', newEndsAt },
  });
  res.json({ message: 'School service has been restored.', subscriptionEndsAt: newEndsAt });
});

// -----------------------------------------------------------------------
// Vouchers
// -----------------------------------------------------------------------
router.post('/vouchers', requirePermission(PERMISSIONS.PLATFORM_MANAGE_VOUCHERS), validateBody(Joi.object({
  durationDays: Joi.number().integer().valid(30, 90, 180, 365).required(),
})), (req, res) => {
  const { raw, tokenHash } = passwords.generateToken();
  const voucherPublicId = publicId('vch');
  db.prepare(`
    INSERT INTO vouchers (public_id, code_hash, duration_days, status, issued_by)
    VALUES (?, ?, ?, 'issued', ?)
  `).run(voucherPublicId, tokenHash, req.body.durationDays, req.user.id);

  auditService.record({
    actorUserId: req.user.id, actorRole: 'PLATFORM_ADMIN', action: 'voucher.issued',
    resourceId: voucherPublicId, newValue: { durationDays: req.body.durationDays },
  });
  res.status(201).json({ voucherId: voucherPublicId, code: raw, durationDays: req.body.durationDays });
});

router.post('/vouchers/redeem', requirePermission(PERMISSIONS.PLATFORM_MANAGE_VOUCHERS), validateBody(Joi.object({
  code: Joi.string().required(),
  schoolPublicId: Joi.string().required(),
})), (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE public_id = ?').get(req.body.schoolPublicId);
  if (!school) return res.status(404).json({ error: 'School not found.' });

  const codeHash = passwords.hashToken(req.body.code);
  const voucher = db.prepare('SELECT * FROM vouchers WHERE code_hash = ? AND status = ?').get(codeHash, 'issued');
  if (!voucher) return res.status(400).json({ error: 'Invalid or already-used voucher code.' });

  // Server calculates the resulting service period; the client only names
  // the voucher — it never gets to submit a duration directly.
  const currentSub = subscriptionService.getActiveSubscription(school.id);
  const base = currentSub && new Date(currentSub.ends_at) > new Date() ? new Date(currentSub.ends_at) : new Date();
  const newEndsAt = new Date(base.getTime() + voucher.duration_days * 24 * 60 * 60 * 1000).toISOString();

  const tx = db.transaction(() => {
    db.prepare('UPDATE vouchers SET status = ?, school_id = ?, activated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'), expires_at = ? WHERE id = ?')
      .run('activated', school.id, newEndsAt, voucher.id);
    db.prepare('UPDATE schools SET status = ?, subscription_ends_at = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
      .run('active', newEndsAt, school.id);
    db.prepare('UPDATE subscriptions SET status = ?, ends_at = ? WHERE school_id = ?').run('active', newEndsAt, school.id);
  });
  tx();

  auditService.record({
    actorUserId: req.user.id, actorRole: 'PLATFORM_ADMIN', schoolId: school.id, action: 'voucher.redeemed',
    resourceId: voucher.public_id, newValue: { newEndsAt },
  });
  res.json({ message: 'Voucher redeemed.', subscriptionEndsAt: newEndsAt });
});

// -----------------------------------------------------------------------
// System health, security, audit, incidents
// -----------------------------------------------------------------------
router.get('/system-health', requirePermission(PERMISSIONS.PLATFORM_VIEW_SYSTEM_HEALTH), (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const errorCount = db.prepare('SELECT COUNT(*) AS n FROM security_events WHERE created_at >= ?').get(since).n;
  const failedLogins = db.prepare('SELECT COUNT(*) AS n FROM security_events WHERE type = ? AND created_at >= ?')
    .get('failed_login', since).n;
  const openIncidents = db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE status NOT IN (?, ?)')
    .get('resolved', 'closed').n;
  const dailyEvents = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM security_events
    WHERE created_at >= ? GROUP BY day ORDER BY day
  `).all(since);
  res.json({ errorCount7d: errorCount, failedLogins7d: failedLogins, openIncidents, dailyEvents });
});

router.get('/security-events', requirePermission(PERMISSIONS.PLATFORM_VIEW_SECURITY_LOGS), (req, res) => {
  const rows = db.prepare('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});

router.get('/audit-logs', requirePermission(PERMISSIONS.PLATFORM_VIEW_SECURITY_LOGS), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows);
});

router.get('/incidents', requirePermission(PERMISSIONS.PLATFORM_MANAGE_INCIDENTS), (req, res) => {
  res.json(db.prepare('SELECT * FROM incidents ORDER BY detected_at DESC').all());
});

router.post('/incidents', requirePermission(PERMISSIONS.PLATFORM_MANAGE_INCIDENTS), validateBody(Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  affectedService: Joi.string().max(100).allow('', null),
  affectedSchoolPublicId: Joi.string().allow('', null),
})), (req, res) => {
  let affectedSchoolId = null;
  if (req.body.affectedSchoolPublicId) {
    const school = db.prepare('SELECT id FROM schools WHERE public_id = ?').get(req.body.affectedSchoolPublicId);
    affectedSchoolId = school ? school.id : null;
  }
  const incidentPublicId = publicId('inc');
  db.prepare(`
    INSERT INTO incidents (public_id, title, severity, affected_service, affected_school_id, responsible_admin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(incidentPublicId, req.body.title, req.body.severity, req.body.affectedService || null, affectedSchoolId, req.user.id);

  auditService.record({
    actorUserId: req.user.id, actorRole: 'PLATFORM_ADMIN', action: 'incident.created',
    resourceId: incidentPublicId, newValue: req.body,
  });
  res.status(201).json({ publicId: incidentPublicId });
});

router.patch('/incidents/:publicId', requirePermission(PERMISSIONS.PLATFORM_MANAGE_INCIDENTS), validateBody(Joi.object({
  status: Joi.string().valid('open', 'investigating', 'mitigated', 'resolved', 'closed').required(),
  notes: Joi.string().max(2000).allow('', null),
})), (req, res) => {
  const incident = db.prepare('SELECT * FROM incidents WHERE public_id = ?').get(req.params.publicId);
  if (!incident) return res.status(404).json({ error: 'Incident not found.' });

  const resolvedAt = ['resolved', 'closed'].includes(req.body.status) ? new Date().toISOString() : incident.resolved_at;
  db.prepare('UPDATE incidents SET status = ?, notes = ?, resolved_at = ? WHERE id = ?')
    .run(req.body.status, req.body.notes || incident.notes, resolvedAt, incident.id);

  auditService.record({
    actorUserId: req.user.id, actorRole: 'PLATFORM_ADMIN', action: 'incident.updated',
    resourceId: incident.public_id, previousValue: { status: incident.status }, newValue: { status: req.body.status },
  });
  res.json({ message: 'Incident updated.' });
});

module.exports = router;
