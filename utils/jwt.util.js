const jwt = require('jsonwebtoken');
const config = require('../config/app.config');

function generateToken(payload) {
  const options = {};
  if (config.jwt.expiresIn) {
    options.expiresIn = config.jwt.expiresIn;
  }
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
