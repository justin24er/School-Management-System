const db = require('../db/connection');
const auditService = require('../services/auditService');

/** Loads the authenticated user (if any) plus their resolved roles and
 * permission set onto req.user. This runs on every request; nothing
 * downstream should re-derive identity from anything the client sent. */
function attachUser(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    req.user = null;
    return next();
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(userId, 'active');
  if (!user) {
    req.session.destroy(() => {});
    req.user = null;
    return next();
  }

  const roles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(user.id).map(r => r.name);

  const permissions = db.prepare(`
    SELECT DISTINCT p.key FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = ?
  `).all(user.id).map(p => p.key);

  req.user = {
    id: user.id,
    publicId: user.public_id,
    schoolId: user.school_id,
    username: user.username,
    email: user.email,
    roles,
    permissions: new Set(permissions),
    mfaEnabled: !!user.mfa_enabled,
  };
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

/** Requires the caller to hold ALL of the given permissions. Denials are
 * audit-logged. This is the actual authorization boundary — routes must not
 * rely on the frontend having hidden a button. */
function requirePermission(...required) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const missing = required.filter(p => !req.user.permissions.has(p));
    if (missing.length > 0) {
      auditService.record({
        actorUserId: req.user.id,
        actorRole: req.user.roles.join(','),
        schoolId: req.user.schoolId,
        action: 'authorization.denied',
        resourceType: 'permission',
        resourceId: missing.join(','),
        result: 'denied',
        req,
      });
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

/** Restricts a route to specific roles. Prefer requirePermission() for
 * business logic; this is useful for platform-vs-school route separation. */
function requireRole(...roleNames) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    const has = req.user.roles.some(r => roleNames.includes(r));
    if (!has) {
      auditService.record({
        actorUserId: req.user.id,
        actorRole: req.user.roles.join(','),
        schoolId: req.user.schoolId,
        action: 'authorization.denied_role',
        result: 'denied',
        req,
      });
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requirePermission, requireRole };
