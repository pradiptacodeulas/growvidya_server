const jwt = require('jsonwebtoken');
const config = require('../config/app.config');

function generateToken(payload, customOptions = {}) {
  const options = {
    expiresIn: config.jwt.expiresIn || '30d',
    ...customOptions,
  };
  return jwt.sign(payload, config.jwt.secret, options);
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
}

module.exports = {
  generateToken,
  verifyToken,
};
