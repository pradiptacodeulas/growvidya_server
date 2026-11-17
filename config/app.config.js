const dotenv = require('dotenv');
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const DEFAULT_JWT_SECRET = 'growvidya_jwt_secret_key';
const DEFAULT_COOKIE_SECRET = 'growvidya_cookie_secret_key_2026';

const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const cookieSecret = process.env.COOKIE_SECRET || DEFAULT_COOKIE_SECRET;

if (nodeEnv === 'production') {
  if (!process.env.JWT_SECRET || jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('FATAL: A strong JWT_SECRET environment variable is required in production.');
  }
  if (!process.env.COOKIE_SECRET || cookieSecret === DEFAULT_COOKIE_SECRET) {
    throw new Error('FATAL: A strong COOKIE_SECRET environment variable is required in production.');
  }
}

const rawCorsOrigins = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
const corsOrigins = [
  ...new Set(
    rawCorsOrigins
      .split(',')
      .map((o) => o.trim())
      .filter((o) => Boolean(o) && !o.endsWith(':'))
  ),
];

module.exports = {
  port: process.env.PORT || 5001,
  nodeEnv,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'grow_portal',
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '30d', // 30 days persistent session
  },
  cookie: {
    secret: cookieSecret,
    name: process.env.COOKIE_NAME || 'growvidya_session',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent session
  },
  corsOrigins,
  corsOrigin: corsOrigins.length > 0 ? corsOrigins : 'http://localhost:5173',
  legacyUploadPath: process.env.LEGACY_UPLOAD_PATH || null,
};

