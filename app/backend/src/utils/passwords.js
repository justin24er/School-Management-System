const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// bcrypt with a 12-round cost factor is used here for portability inside a
// sandboxed/demo environment with no native compiler guarantees. In a real
// production deployment, prefer Argon2id (the `argon2` package) — swap
// hash()/verify() below for argon2.hash()/argon2.verify() and re-hash on
// next successful login for any existing bcrypt hashes. Never store
// passwords in plaintext or with reversible encryption either way.
const SALT_ROUNDS = 12;

async function hash(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verify(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

const PASSWORD_RULES = {
  minLength: 10,
  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/,
  description: 'At least 10 characters, including upper and lower case letters, a number, and a symbol.',
};

function isStrongPassword(password) {
  return typeof password === 'string' && PASSWORD_RULES.pattern.test(password);
}

/** Generates a cryptographically random token and returns both the raw
 * value (sent to the user once, e.g. in an invite/reset link) and its
 * SHA-256 hash (the only thing persisted). This means a database read
 * alone never yields a usable token. */
function generateToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, tokenHash };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { hash, verify, isStrongPassword, PASSWORD_RULES, generateToken, hashToken };
