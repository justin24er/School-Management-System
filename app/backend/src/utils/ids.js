const { v4: uuidv4 } = require('uuid');

/**
 * Generates a non-sequential public identifier for a resource type, e.g.
 * "stu_3f2a9c1b4e...". Internal integer primary keys are never exposed in
 * API responses or URLs; this is what clients see and send instead. Note
 * per architecture: this is an obfuscation/UX measure, not an authorization
 * boundary — every route still checks tenant ownership and permissions.
 */
function publicId(prefix) {
  return `${prefix}_${uuidv4().replace(/-/g, '')}`;
}

module.exports = { publicId };
