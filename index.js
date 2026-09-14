const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const config = require('./config/app.config');
const { testConnection } = require('./config/db.config');
const { initSocket } = require('./services/socket.service');
const MessageModel = require('./models/message.model');
const BranchModel = require('./models/branch.model');

// Middleware & Router Imports
const errorMiddleware = require('./middlewares/error.middleware');
const paramsDecoderMiddleware = require('./middlewares/paramsDecoder.middleware');
const apiRoutes = require('./routes');
const ApiResponse = require('./utils/api.response');

const app = express();

// ==========================================
// 1. Security & Body Parsing Middlewares
// ==========================================
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);


app.use(
  express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser(config.cookie.secret));
app.use(paramsDecoderMiddleware);

// ==========================================
// 2. Static Assets & Uploads
// ==========================================
const uploadDir = path.join(__dirname, 'public/upload');
const assetsDir = path.join(__dirname, 'public/assets');

// Primary static uploads & assets
app.use('/upload', express.static(uploadDir));
app.use('/vidya_assets', express.static(uploadDir));
app.use('/assets', express.static(assetsDir));
app.use('/vidya_assets/images', express.static(assetsDir));

// Optional legacy upload directory from environment
if (config.legacyUploadPath && fs.existsSync(config.legacyUploadPath)) {
  app.use('/upload', express.static(config.legacyUploadPath));
}

// Fallback search resolver for nested subdirectories in public/upload
const uploadSubDirs = [
  'study_material',
  'general',
  'teacher/attachment',
  'teacher',
  'student/attachment',
  'student',
  'staff',
];

app.use(async (req, res, next) => {
  if (req.method === 'GET' && req.path.startsWith('/upload/')) {
    const filename = path.basename(req.path);
    for (const sub of uploadSubDirs) {
      const candidate = path.join(uploadDir, sub, filename);
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isFile()) return res.sendFile(candidate);
      } catch (_) {}
    }
  }
  next();
});

// ==========================================
// 3. API Routes Mount
// ==========================================
app.use('/api', apiRoutes);

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

server.listen(config.port, async () => {
  const dbStatus = await testConnection();
  await BranchModel.initTable();
  await MessageModel.initTable();

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

module.exports = { app, server };
