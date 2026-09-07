const rateLimit = require('express-rate-limit');

// Progressive throttling, not permanent lockout: short windows with modest
// caps slow down brute-force/credential-stuffing without permanently
// blocking a genuine user who mistyped their password a few times. Combined
// with the per-account failed-login counter in authService for defense in
// depth.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

const trialSignupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many trial signup attempts from this network. Please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, passwordResetLimiter, trialSignupLimiter, apiLimiter };
