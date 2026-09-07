const db = require('../db/connection');

/**
 * Records an entry in the audit trail. Never pass passwords, tokens, or
 * other secrets in `previousValue`/`newValue` — only business field values.
 */
function record({
  actorUserId = null,
  actorRole = null,
  schoolId = null,
  action,
  resourceType = null,
  resourceId = null,
  previousValue = null,
  newValue = null,
  result = 'success',
  req = null,
}) {
  db.prepare(`
    INSERT INTO audit_logs
      (actor_user_id, actor_role, school_id, action, resource_type, resource_id,
       previous_value, new_value, result, ip_address, user_agent)
    VALUES (@actorUserId, @actorRole, @schoolId, @action, @resourceType, @resourceId,
            @previousValue, @newValue, @result, @ip, @userAgent)
  `).run({
    actorUserId,
    actorRole,
    schoolId,
    action,
    resourceType,
    resourceId,
    previousValue: previousValue == null ? null : JSON.stringify(previousValue),
    newValue: newValue == null ? null : JSON.stringify(newValue),
    result,
    ip: req ? req.ip : null,
    userAgent: req ? req.get('user-agent') : null,
  });
}

function recordSecurityEvent({ type, userId = null, schoolId = null, detail = null, req = null }) {
  db.prepare(`
    INSERT INTO security_events (type, user_id, school_id, ip_address, detail)
    VALUES (@type, @userId, @schoolId, @ip, @detail)
  `).run({
    type,
    userId,
    schoolId,
    ip: req ? req.ip : null,
    detail: detail == null ? null : JSON.stringify(detail),
  });
}

module.exports = { record, recordSecurityEvent };
