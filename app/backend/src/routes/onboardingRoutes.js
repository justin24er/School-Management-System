const express = require('express');
const Joi = require('joi');
const db = require('../db/connection');
const { publicId } = require('../utils/ids');
const passwords = require('../utils/passwords');
const auditService = require('../services/auditService');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireSchoolContext } = require('../middleware/tenant');
const { trialSignupLimiter } = require('../middleware/rateLimits');
const { validateBody } = require('../utils/validate');
const { PERMISSIONS, ROLES } = require('../config/permissions');

const router = express.Router();
const TRIAL_DAYS = Number(process.env.TRIAL_LENGTH_DAYS || 30);
const INVITE_TTL_HOURS = Number(process.env.INVITE_TOKEN_TTL_HOURS || 72);

/**
 * Step 1-3 of the onboarding flow (spec section 16): a public visitor
 * starts a trial, which provisions a new school tenant and its single
 * owner/SED account in one transaction. This endpoint intentionally never
 * accepts a "role" field — the created account is always SED. Head
 * Teacher / Accountant accounts only ever come from invitations issued by
 * an existing SED (see /invitations below).
 */
router.post('/start-trial',
  trialSignupLimiter,
  validateBody(Joi.object({
    schoolName: Joi.string().trim().min(2).max(200).required(),
    ownerUsername: Joi.string().trim().alphanum().min(3).max(40).required(),
    ownerEmail: Joi.string().email({ tlds: { allow: false } }).required(),
    password: Joi.string().required(),
  })),
  async (req, res) => {
    const { schoolName, ownerUsername, ownerEmail, password } = req.body;

    if (!passwords.isStrongPassword(password)) {
      return res.status(400).json({ error: passwords.PASSWORD_RULES.description });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await passwords.hash(password);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const schoolPublicId = publicId('sch');
    const userPublicId = publicId('usr');

    const tx = db.transaction(() => {
      const schoolInfo = db.prepare(`
        INSERT INTO schools (public_id, name, status, trial_ends_at)
        VALUES (?, ?, 'trial', ?)
      `).run(schoolPublicId, schoolName, trialEndsAt);
      const schoolId = schoolInfo.lastInsertRowid;

      db.prepare(`
        INSERT INTO subscriptions (school_id, plan, status, ends_at) VALUES (?, 'standard', 'trial', ?)
      `).run(schoolId, trialEndsAt);

      const userInfo = db.prepare(`
        INSERT INTO users (public_id, school_id, username, email, password_hash, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(userPublicId, schoolId, ownerUsername, ownerEmail, passwordHash);
      const userId = userInfo.lastInsertRowid;

      const sedRole = db.prepare('SELECT id FROM roles WHERE name = ?').get(ROLES.SED);
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, sedRole.id);

      // Sensible default expense categories so a new school's dashboards
      // are usable immediately without inventing fake data.
      const categories = [
        ['Water', 'resource'], ['Electricity', 'resource'], ['Maintenance', 'resource'],
        ['Supplies', 'operational'], ['Infrastructure', 'infrastructure'],
      ];
      const insertCat = db.prepare('INSERT INTO expense_categories (public_id, school_id, name, kind) VALUES (?, ?, ?, ?)');
      for (const [name, kind] of categories) insertCat.run(publicId('cat'), schoolId, name, kind);

      return { schoolId, userId };
    });

    const { schoolId, userId } = tx();

    auditService.record({
      actorUserId: userId, schoolId, action: 'onboarding.trial_started',
      resourceType: 'school', resourceId: String(schoolId),
    });

    res.status(201).json({
      message: `Trial started. Your school has a ${TRIAL_DAYS}-day free trial.`,
      school: { publicId: schoolPublicId, name: schoolName, trialEndsAt },
    });
  }
);

/** SED (or another user holding school_users.manage) invites a Head
 * Teacher or Accountant into their own school. The role is fixed by the
 * inviter's request but always validated against an allow-list — a school
 * user can never invite another Admin or invite into a different school. */
router.post('/invitations',
  requireAuth, requireSchoolContext, requirePermission(PERMISSIONS.SCHOOL_USERS_MANAGE),
  validateBody(Joi.object({
    email: Joi.string().email({ tlds: { allow: false } }).required(),
    role: Joi.string().valid(ROLES.HEAD_TEACHER, ROLES.ACCOUNTANT).required(),
  })),
  (req, res) => {
    const { email, role } = req.body;
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role);

    const { raw, tokenHash } = passwords.generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const invitePublicId = publicId('inv');

    db.prepare(`
      INSERT INTO invitations (public_id, school_id, email, role_id, token_hash, invited_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(invitePublicId, req.schoolId, email, roleRow.id, tokenHash, req.user.id, expiresAt);

    auditService.record({
      actorUserId: req.user.id, schoolId: req.schoolId, action: 'invitation.created',
      resourceType: 'invitation', resourceId: invitePublicId, newValue: { email, role },
    });

    // Production sends this by email; returned here only in non-production
    // for a working prototype with no email provider wired up.
    const response = { message: 'Invitation created.', invitation: { id: invitePublicId, email, role, expiresAt } };
    if (process.env.NODE_ENV !== 'production') response.devOnlyInviteToken = raw;
    res.status(201).json(response);
  }
);

router.post('/invitations/accept',
  validateBody(Joi.object({
    token: Joi.string().required(),
    username: Joi.string().trim().alphanum().min(3).max(40).required(),
    password: Joi.string().required(),
  })),
  async (req, res) => {
    const { token, username, password } = req.body;
    if (!passwords.isStrongPassword(password)) {
      return res.status(400).json({ error: passwords.PASSWORD_RULES.description });
    }
    const tokenHash = passwords.hashToken(token);
    const invite = db.prepare(`
      SELECT * FROM invitations WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL
    `).get(tokenHash);

    if (!invite || new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
    }

    const passwordHash = await passwords.hash(password);
    const userPublicId = publicId('usr');

    const tx = db.transaction(() => {
      const userInfo = db.prepare(`
        INSERT INTO users (public_id, school_id, username, email, password_hash, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(userPublicId, invite.school_id, username, invite.email, passwordHash);
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userInfo.lastInsertRowid, invite.role_id);
      db.prepare('UPDATE invitations SET used_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?').run(invite.id);
      return userInfo.lastInsertRowid;
    });
    const userId = tx();

    auditService.record({
      actorUserId: userId, schoolId: invite.school_id, action: 'invitation.accepted',
      resourceType: 'user', resourceId: userPublicId,
    });

    res.status(201).json({ message: 'Your account has been created. You can now log in.' });
  }
);

module.exports = router;
