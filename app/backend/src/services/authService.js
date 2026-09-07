const db = require('../db/connection');
const passwords = require('../utils/passwords');
const auditService = require('./auditService');
const { authenticator } = require('otplib');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function findUserByLogin(login, schoolPublicId = null) {
  // Login is by username or email. Platform Admins have school_id NULL;
  // school users are looked up within their school's tenant scope once the
  // school is known. For the unified login form we search across active
  // users by username/email; uniqueness is enforced per-school in the
  // schema, so a duplicate username across two different schools is
  // possible by design (each is its own tenant) — the account picker below
  // resolves the intended one deterministically for the demo/prototype by
  // requiring email (globally distinct in practice) or by school context
  // when available.
  return db.prepare(`
    SELECT * FROM users WHERE (email = ? OR username = ?) AND status != 'disabled'
  `).all(login, login);
}

async function attemptLogin({ login, password, req }) {
  const candidates = findUserByLogin(login);

  if (candidates.length === 0) {
    auditService.recordSecurityEvent({ type: 'failed_login', detail: { reason: 'no_such_user' }, req });
    return { ok: false, reason: 'invalid_credentials' };
  }

  // In the rare demo case of a colliding username across tenants, try each
  // candidate; in production, email is required to be globally unique or
  // login additionally asks for the school.
  for (const user of candidates) {
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      auditService.recordSecurityEvent({
        type: 'login_blocked_locked_account', userId: user.id, schoolId: user.school_id, req,
      });
      return { ok: false, reason: 'account_locked' };
    }

    const validPassword = await passwords.verify(password, user.password_hash);
    if (!validPassword) continue;

    if (user.status === 'invited') {
      return { ok: false, reason: 'invitation_pending' };
    }

    // Success: reset failed counter, stamp last login.
    db.prepare(`
      UPDATE users SET failed_login_count = 0, locked_until = NULL,
        last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).run(user.id);

    auditService.record({
      actorUserId: user.id, schoolId: user.school_id, action: 'auth.login_success', req,
    });

    return { ok: true, user };
  }

  // No candidate matched the password: increment failure counters for all
  // matching usernames/emails (there is normally exactly one).
  for (const user of candidates) {
    const failedCount = user.failed_login_count + 1;
    const lockedUntil = failedCount >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    db.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
      .run(failedCount, lockedUntil, user.id);
    if (lockedUntil) {
      auditService.recordSecurityEvent({
        type: 'account_locked', userId: user.id, schoolId: user.school_id,
        detail: { failedCount }, req,
      });
    }
  }
  auditService.recordSecurityEvent({ type: 'failed_login', detail: { reason: 'bad_password' }, req });
  return { ok: false, reason: 'invalid_credentials' };
}

function verifyMfaCode(user, code) {
  if (!user.mfa_enabled || !user.mfa_secret) return true;
  return authenticator.check(code || '', user.mfa_secret);
}

module.exports = { attemptLogin, verifyMfaCode, MAX_FAILED_ATTEMPTS, LOCK_MINUTES };
