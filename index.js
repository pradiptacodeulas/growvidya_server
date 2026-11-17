const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config/app.config');
const { testConnection } = require('./config/db.config');
const { initSocket } = require('./services/socket.service');
const MessageModel = require('./models/message.model');
const BranchModel = require('./models/branch.model');
const SupportTicketModel = require('./models/supportTicket.model');
const DeviceTokenModel = require('./models/deviceToken.model');
const TeacherSelfAttendanceModel = require('./models/teacherSelfAttendance.model');
const SubscriptionSchemaModel = require('./models/subscriptionSchema.model');
const FileStorageLedgerModel = require('./models/fileStorageLedger.model');
const EmailCredentialModel = require('./models/emailCredential.model');
const SubscriptionLifecycleJob = require('./jobs/subscriptionLifecycle.job');

// Middleware & Router Imports
const errorMiddleware = require('./middlewares/error.middleware');
const paramsDecoderMiddleware = require('./middlewares/paramsDecoder.middleware');
const storageAccessMiddleware = require('./middlewares/storageAccess.middleware');
const apiRoutes = require('./routes');
const couponRoutes = require('./routes/coupon.routes');
const ApiResponse = require('./utils/api.response');

const app = express();
// Super Admin Multi-Branch Module Enabled

// ==========================================
// 1. Security & Body Parsing Middlewares
// ==========================================
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = config.corsOrigins;

if (allowedOrigins.length === 0) {
  console.warn('CORS_ORIGINS is empty: all cross-origin browser requests will be blocked');
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));


app.use(
  express.json({
    limit: '50mb',
    type: (req) => {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      
      if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
        return false;
      }
      return true;
    },
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure req.body is always an object, and attempt fallback parsing if Content-Type was missing
app.use((req, res, next) => {
  if (req.body === undefined || req.body === null || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
    if (req.rawBody && req.rawBody.length > 0) {
      try {
        const text = req.rawBody.toString('utf8').trim();
        if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
          req.body = JSON.parse(text);
        }
      } catch (_) {}
    }
  }

  // Guarantee req.body is defined as an object so destructuring never crashes
  if (req.body === undefined || req.body === null) {
    req.body = {};
  }
  next();
});

app.use(cookieParser(config.cookie.secret));
app.use(paramsDecoderMiddleware);

// ==========================================
// 2. Static UI Assets & Authorized B2 Cloud Storage Gateway
// ==========================================
const assetsDir = path.join(__dirname, 'public/assets');
app.use('/assets', express.static(assetsDir));
app.use('/vidya_assets/images', express.static(assetsDir));

// Intercept all /upload/* requests: enforce JWT auth + tenant isolation and stream from Backblaze B2
app.use(storageAccessMiddleware);

// ==========================================
// 3. API Routes Mount
// ==========================================
app.use('/api', apiRoutes);
app.use('/coupons', couponRoutes);
app.use('/v1/coupons', couponRoutes);

// ==========================================
// 4. 404 & Central Error Handling
// ==========================================
app.use((req, res) => {
  return ApiResponse.error(res, `Route not found: ${req.method} ${req.originalUrl}`, null, 404);
});

app.use(errorMiddleware);

// ==========================================
// 5. Server Startup & Real-time Sockets
// ==========================================
const server = http.createServer(app);
initSocket(server, config);

async function startServer() {
  const dbStatus = await testConnection();
  if (dbStatus?.ok) {
    await EmailCredentialModel.initTable();
    await SubscriptionSchemaModel.initTable();
    await FileStorageLedgerModel.initTable();
    await BranchModel.initTable();
    await TeacherSelfAttendanceModel.initTable();
    await MessageModel.initTable();
    await SupportTicketModel.initTable();
    await DeviceTokenModel.initTable();
  }

  server.listen(config.port, () => {
    if (dbStatus?.ok) {
      SubscriptionLifecycleJob.start();
    }

    console.log(`\n  \x1b[1m\x1b[36mGrowvidya Core API Server\x1b[0m \x1b[90mv1.0.0\x1b[0m`);
    console.log(`  \x1b[90m──────────────────────────────────────────────────\x1b[0m`);
    console.log(`  \x1b[32m●\x1b[0m \x1b[1mStatus\x1b[0m       : Ready and listening`);
    console.log(`    \x1b[1mLocal\x1b[0m        : \x1b[36mhttp://localhost:${config.port}\x1b[0m`);
    console.log(`    \x1b[1mHealth\x1b[0m       : \x1b[36mhttp://localhost:${config.port}/api/health\x1b[0m`);
    console.log(`    \x1b[1mEnvironment\x1b[0m  : \x1b[33m${config.nodeEnv}\x1b[0m`);
    if (dbStatus?.ok) {
      console.log(`    \x1b[1mDatabase\x1b[0m     : \x1b[32mConnected\x1b[0m (MySQL: ${config.db.database} @ ${config.db.host}:${config.db.port})`);
    } else {
      console.log(`    \x1b[1mDatabase\x1b[0m     : \x1b[31mConnection Failed\x1b[0m (${dbStatus?.error || 'Unknown error'})`);
    }
    console.log(`    \x1b[1mRealtime\x1b[0m     : \x1b[32mInitialized\x1b[0m (Socket.IO active)`);
    console.log(`  \x1b[90m──────────────────────────────────────────────────\x1b[0m\n`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server Startup Fatal Error]:', err);
    process.exit(1);
  });
}

module.exports = { app, server, startServer };
