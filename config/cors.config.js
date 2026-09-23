const config = require('./app.config');

// Base list of explicitly configured origins
const rawOrigins = Array.isArray(config.corsOrigin)
  ? config.corsOrigin
  : (config.corsOrigin ? String(config.corsOrigin).split(',').map((s) => s.trim()) : []);

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://192.168.29.231',
  'http://192.168.29.231:5173',
  'http://192.168.29.231:5174',
  'http://192.168.29.231:3000',
  'http://192.168.29.243',
  'http://192.168.29.243:5173',
  'http://192.168.29.243:5174',
  'http://192.168.29.243:3000',
];

const allowedOriginsSet = new Set([...rawOrigins, ...defaultAllowedOrigins]);

/**
 * Checks whether an incoming origin is permitted.
 * Automatically allows:
 *  - Requests without origin (curl, postman, mobile apps, same-origin)
 *  - Explicitly configured origins (including http://192.168.29.231)
 *  - Any port on localhost or 127.0.0.1
 *  - Any port on private LAN subnets (192.168.*, 10.*, 172.16-31.*)
 */
function isOriginAllowed(origin) {
  if (!origin) return true;

  const cleanOrigin = origin.replace(/\/+$/, '');

  // 1. Direct match in allowed set
  if (allowedOriginsSet.has(cleanOrigin) || allowedOriginsSet.has(origin)) {
    return true;
  }

  // 2. Localhost / loopback on any port
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 3. Any private network / LAN IP on any port
  if (
    /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(cleanOrigin) ||
    /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(cleanOrigin) ||
    /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(cleanOrigin)
  ) {
    return true;
  }

  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from disallowed origin: ${origin}`);
      callback(new Error(`CORS error: Origin ${origin} not allowed.`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Range',
    'x-school-id',
    'x-academic-year-id',
    'x-branch-id',
    'x-csrf-token',
  ],
  exposedHeaders: ['Content-Range', 'X-Total-Count', 'Authorization', 'Set-Cookie'],
  maxAge: 86400,
};

module.exports = {
  corsOptions,
  isOriginAllowed,
};
