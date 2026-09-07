const subscriptionService = require('../services/subscriptionService');

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

function start() {
  const run = () => {
    try {
      const updated = subscriptionService.sweep();
      if (updated > 0) {
        // eslint-disable-next-line no-console
        console.log(`Subscription sweep: transitioned ${updated} school(s).`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Subscription sweep failed:', err.message);
    }
  };
  run();
  return setInterval(run, SWEEP_INTERVAL_MS);
}

module.exports = { start };
