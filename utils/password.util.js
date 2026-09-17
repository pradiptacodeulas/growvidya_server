const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Hash password using MD5 hex digest to maintain 100% compatibility
 * with Growvidya database schema and PHP backend.
 */
async function hashPassword(plainPassword) {
  if (plainPassword === null || plainPassword === undefined) return '';
  return await bcrypt.hash(String(plainPassword), 10);
}

/**
 * Compare plain text password against stored hash.
 * Supports bcrypt (primary for modern passwords) and MD5 (backward compatibility).
 */
async function comparePassword(plainPassword, storedHash) {
  if (!storedHash || !plainPassword) return false;

  const cleanPlain = String(plainPassword);
  const cleanStored = String(storedHash).trim();

  // 1. Primary Check: bcrypt hash
  if (cleanStored.startsWith('$2a$') || cleanStored.startsWith('$2b$') || cleanStored.startsWith('$2y$')) {
    try {
      const isBcryptValid = await bcrypt.compare(cleanPlain, cleanStored);
      if (isBcryptValid) return true;
    } catch (_) {}
  }

  // 2. Legacy Check: MD5 Hash match (for existing accounts before migration)
  const md5Hash = crypto.createHash('md5').update(cleanPlain).digest('hex');
  if (md5Hash.toLowerCase() === cleanStored.toLowerCase()) {
    return true;
  }

  return false;
}

module.exports = {
  hashPassword,
  comparePassword,
};

