const db = require('../db/connection');
const subscriptionService = require('../services/subscriptionService');

/**
 * Resolves the tenant (school) context strictly from the authenticated
 * session — never from a request parameter, header, or body field. This is
 * the enforcement point for multi-tenancy: every school-scoped route uses
 * req.schoolId from here in its WHERE clauses, so a School A user can never
 * pull School B rows no matter what id they put in the URL.
 */
function requireSchoolContext(req, res, next) {
  if (!req.user || !req.user.schoolId) {
    return res.status(403).json({ error: 'This action requires a school account.' });
  }
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.user.schoolId);
  if (!school) {
    return res.status(403).json({ error: 'School account not found.' });
  }
  req.school = school;
  req.schoolId = school.id;
  next();
}

/** Blocks operational writes (POST/PUT/PATCH/DELETE) once a school's
 * subscription no longer allows them, regardless of what the frontend
 * shows. Reads remain available so the school can see its own status. */
function enforceSubscriptionForWrites(req, res, next) {
  if (!req.school) return next();
  const sub = subscriptionService.getActiveSubscription(req.school.id);
  const status = subscriptionService.computeStatus(sub);

  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isWrite && !subscriptionService.allowsOperationalWrites(status)) {
    return res.status(402).json({
      error: 'Your school service period has ended. Renew your subscription to continue.',
      subscriptionStatus: status,
    });
  }
  req.subscriptionStatus = status;
  next();
}

module.exports = { requireSchoolContext, enforceSubscriptionForWrites };
