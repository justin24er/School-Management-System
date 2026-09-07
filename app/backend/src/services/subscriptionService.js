const db = require('../db/connection');
const auditService = require('./auditService');

const GRACE_PERIOD_DAYS = 7;
const EXPIRING_SOON_DAYS = 7;

/**
 * Computes the authoritative subscription status for a school from its
 * subscription end date. This is deliberately the ONLY place that decides
 * whether a school is allowed to perform operational mutations — the
 * frontend never makes this decision, it only reflects what this function
 * (via the API) reports. Called by the tenant/subscription middleware on
 * every request that touches school data, and by the scheduled sweep.
 */
function computeStatus(subscription, now = new Date()) {
  if (!subscription) return 'expired';
  if (['frozen', 'suspended', 'cancelled'].includes(subscription.status)) {
    return subscription.status;
  }
  const endsAt = new Date(subscription.ends_at);
  const msRemaining = endsAt.getTime() - now.getTime();
  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);

  if (daysRemaining > EXPIRING_SOON_DAYS) return subscription.status === 'trial' ? 'trial' : 'active';
  if (daysRemaining > 0) return 'expiring_soon';
  if (daysRemaining > -GRACE_PERIOD_DAYS) return 'grace_period';
  return 'expired';
}

/** Returns whether a school in the given status may perform operational
 * writes (create/update/delete on business records). Read access to their
 * own account/subscription info is always allowed regardless of status. */
function allowsOperationalWrites(status) {
  return ['trial', 'active', 'expiring_soon', 'grace_period'].includes(status);
}

function getActiveSubscription(schoolId) {
  return db.prepare(
    'SELECT * FROM subscriptions WHERE school_id = ? ORDER BY id DESC LIMIT 1'
  ).get(schoolId);
}

/** Recomputes and persists status for every subscription whose stored
 * status has drifted from the computed one, and syncs schools.status.
 * Intended to run on a schedule (see src/jobs/subscriptionSweep.js) and is
 * also invoked defensively by middleware so status is never stale for long. */
function sweep() {
  const subs = db.prepare('SELECT * FROM subscriptions').all();
  const now = new Date();
  let updated = 0;
  for (const sub of subs) {
    const computed = computeStatus(sub, now);
    if (computed !== sub.status) {
      db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(computed, sub.id);
      db.prepare('UPDATE schools SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
        .run(computed, sub.school_id);
      auditService.record({
        action: 'subscription.status_transition',
        resourceType: 'subscription',
        resourceId: String(sub.id),
        schoolId: sub.school_id,
        previousValue: { status: sub.status },
        newValue: { status: computed },
      });
      updated += 1;
    }
  }
  return updated;
}

module.exports = { computeStatus, allowsOperationalWrites, getActiveSubscription, sweep, GRACE_PERIOD_DAYS };
