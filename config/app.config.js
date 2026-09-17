const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'grow_portal',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'growvidya_jwt_secret_key',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d', // 30 days persistent session
  },
  cookie: {
    secret: process.env.COOKIE_SECRET || 'growvidya_cookie_secret_key_2026',
    name: process.env.COOKIE_NAME || 'growvidya_session',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent session
  },
  corsOrigin: process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.includes(',')
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : (process.env.CORS_ORIGIN || 'http://localhost:5173'),
  legacyUploadPath: process.env.LEGACY_UPLOAD_PATH || null,
};

