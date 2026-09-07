const express = require('express');
const Joi = require('joi');
const { authenticator } = require('otplib');
const db = require('../db/connection');
const passwords = require('../utils/passwords');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimits');
const { validateBody } = require('../utils/validate');

const router = express.Router();

const ROLE_DASHBOARD = {
  PLATFORM_ADMIN: '/dashboards/admin.html',
  SED: '/dashboards/sed.html',
  HEAD_TEACHER: '/dashboards/head-teacher.html',
  ACCOUNTANT: '/dashboards/accountant.html',
};

function loadRolesAndSchool(user) {
  const roles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?
  `).all(user.id).map(r => r.name);
  const school = user.school_id
    ? db.prepare('SELECT id, public_id, name, status, logo_path FROM schools WHERE id = ?').get(user.school_id)
    : null;
  return { roles, school };
}

router.post('/login',
  loginLimiter,
  validateBody(Joi.object({
    login: Joi.string().trim().min(1).max(255).required(),
    password: Joi.string().min(1).max(255).required(),
    mfaCode: Joi.string().trim().allow('').optional(),
  })),
  async (req, res, next) => {
    try {
      const { login, password, mfaCode } = req.body;
      const result = await authService.attemptLogin({ login, password, req });

      // Uniform, non-enumerating failure message regardless of which step failed.
      const genericError = 'The username/email or password you entered is incorrect.';

      if (!result.ok) {
        if (result.reason === 'account_locked') {
          return res.status(423).json({
            error: `This account is temporarily locked due to repeated failed attempts. Try again in ${authService.LOCK_MINUTES} minutes.`,
          });
        }
        if (result.reason === 'invitation_pending') {
          return res.status(403).json({ error: 'This account has not completed its invitation setup yet.' });
        }
        return res.status(401).json({ error: genericError });
      }

      const { user } = result;

      if (user.mfa_enabled) {
        if (!authService.verifyMfaCode(user, mfaCode)) {
          auditService.recordSecurityEvent({ type: 'mfa_failed', userId: user.id, schoolId: user.school_id, req });
          return res.status(401).json({ error: 'Invalid or missing authentication code.', mfaRequired: true });
        }
      }

      // Session rotation on login to prevent session fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        const { roles, school } = loadRolesAndSchool(user);
        const primaryRole = roles[0] || null;
        res.json({
          user: {
            id: user.public_id,
            username: user.username,
            email: user.email,
            roles,
          },
          school,
          redirectTo: ROLE_DASHBOARD[primaryRole] || '/dashboards/head-teacher.html',
        });
      });
    } catch (err) { next(err); }
  }
);

router.post('/logout', (req, res) => {
  const userId = req.user ? req.user.id : null;
  const schoolId = req.user ? req.user.schoolId : null;
  req.session.destroy(() => {
    if (userId) auditService.record({ actorUserId: userId, schoolId, action: 'auth.logout' });
    res.clearCookie('sma.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { roles, school } = loadRolesAndSchool(user);
  res.json({
    user: {
      id: user.public_id,
      username: user.username,
      email: user.email,
      roles,
      mfaEnabled: !!user.mfa_enabled,
      permissions: Array.from(req.user.permissions),
    },
    school,
  });
});

// Password reset request: response is identical whether or not the account
// exists, to avoid account enumeration.
router.post('/forgot-password',
  passwordResetLimiter,
  validateBody(Joi.object({ email: Joi.string().email({ tlds: { allow: false } }).required() })),
  (req, res) => {
    const { email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(email, 'active');
    const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

    if (!user) return res.json(genericResponse);

    const { raw, tokenHash } = passwords.generateToken();
    const ttlMinutes = Number(process.env.RESET_TOKEN_TTL_MINUTES || 30);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)
    `).run(user.id, tokenHash, expiresAt);

    auditService.record({ actorUserId: user.id, schoolId: user.school_id, action: 'auth.password_reset_requested' });

    // In production this token is emailed, never returned in the API
    // response. It is returned here ONLY because this is a self-contained
    // prototype with no email provider configured — see docs/README-internal.md.
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ...genericResponse, devOnlyResetToken: raw });
    }
    res.json(genericResponse);
  }
);

router.post('/reset-password',
  passwordResetLimiter,
  validateBody(Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().required(),
  })),
  async (req, res) => {
    const { token, newPassword } = req.body;
    if (!passwords.isStrongPassword(newPassword)) {
      return res.status(400).json({ error: passwords.PASSWORD_RULES.description });
    }
    const tokenHash = passwords.hashToken(token);
    const record = db.prepare(`
      SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL
    `).get(tokenHash);

    if (!record || new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const newHash = await passwords.hash(newPassword);
    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?')
        .run(newHash, record.user_id);
      db.prepare('UPDATE password_reset_tokens SET used_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
        .run(record.id);
    });
    tx();

    const user = db.prepare('SELECT school_id FROM users WHERE id = ?').get(record.user_id);
    auditService.record({ actorUserId: record.user_id, schoolId: user.school_id, action: 'auth.password_reset_completed' });

    res.json({ message: 'Your password has been updated. You can now log in.' });
  }
);

// MFA enrollment (TOTP). Setting up MFA requires an authenticated session;
// it is not exposed at registration to keep the onboarding flow simple, but
// is available to any account and required for platform Admin accounts by
// policy (enforced in the admin provisioning workflow, see onboardingRoutes).
router.post('/mfa/setup', requireAuth, (req, res) => {
  const secret = authenticator.generateSecret();
  db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, req.user.id);
  const otpauth = authenticator.keyuri(req.user.email, 'The School Management App', secret);
  res.json({ secret, otpauth });
});

router.post('/mfa/enable',
  requireAuth,
  validateBody(Joi.object({ code: Joi.string().required() })),
  (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user.mfa_secret || !authenticator.check(req.body.code, user.mfa_secret)) {
      return res.status(400).json({ error: 'That code did not match. Please try again.' });
    }
    db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(user.id);
    auditService.record({ actorUserId: user.id, schoolId: user.school_id, action: 'auth.mfa_enabled' });
    res.json({ message: 'Two-factor authentication is now enabled on your account.' });
  }
);

module.exports = router;
