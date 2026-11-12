const express = require('express');
const helmet = require('helmet');
const cors = require('cors');


const requestIdMiddleware = require('./middleware/request-id.middleware');
const errorMiddleware = require('./middleware/error.middleware');
const { buildSafeError } = require('./utils/api-response.util');

const app = express();

require('./config/runtime-security').validateRuntimeSecrets();
const { createRequestBoundary } = require('./middleware/request-boundary');
const boundary = createRequestBoundary();
app.disable('x-powered-by');
app.use(requestIdMiddleware);
app.use(boundary.guard);

// Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  hsts: false,
  xFrameOptions: { action: 'deny' },
}));

// Exact origins only; the request boundary also rejects foreign requests.
app.use(cors({
  origin: boundary.corsOrigin,
  exposedHeaders: ['X-CSRF-Token', 'X-App-Build', 'X-Request-ID'],
  credentials: true
}));

// Reject oversized JSON bodies before route processing.
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  if (process.env.APP_BUILD_ID) {
    res.setHeader('X-App-Build', process.env.APP_BUILD_ID);
  }
  next();
});

const crypto = require('crypto');
const session = require('express-session');

const { SESSION_COOKIE_NAME, sessionCookieOptions, sessionMaxAge } = require('./config/session.config');

// Session Configuration
app.use(session({
  name: SESSION_COOKIE_NAME,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new (require('./storage/session-store'))(),
  rolling: false,
  cookie: {
    ...sessionCookieOptions,
    maxAge: sessionMaxAge
  }
}));

// Anonymous sessions receive CSRF tokens; identity is established by login.
app.use((req, res, next) => {
  if (req.session) {
    if (!req.session.user) {
      // Identity is established only by setup/login.
    }
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.setHeader('X-CSRF-Token', req.session.csrfToken);
  }
  next();
});
// CSRF Generation Endpoint moved to security.routes.js

// --- Routes ---
const userRoutes = require('./routes/user.routes');
const securityRoutes = require('./routes/security.routes');
const connectionRoutes = require('./routes/connection.routes');
const vrRoutes = require('./routes/vr.routes');
const srmRoutes = require('./routes/srm.routes');
const drRoutes = require('./routes/dr.routes');
const syncRoutes = require('./routes/sync.routes');
const aiRoutes = require('./routes/ai.routes');

app.get('/api/health', (req, res) => res.json({ status: 'ok', storage: 'json-files', database: false }));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/security', securityRoutes);
app.use('/api', require('./middleware/auth.middleware').requireAuth);
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/users', userRoutes);
app.use(require('./services/configuration-admission').operationGuard);
app.use('/api/connections', connectionRoutes);
app.use('/api/vr', vrRoutes);
app.use('/api/srm', srmRoutes);
app.use('/api/dr', drRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/ai', aiRoutes);
const apiRoutes = require('./routes/api.routes');
app.use('/api', apiRoutes);


app.use('/api', (req, res) => {
  res.status(404).json(buildSafeError(req, {
    type: 'NOT_FOUND_ERROR',
    code: 'API_ROUTE_NOT_FOUND',
    httpStatus: 404,
    safeMessage: 'The requested API was not found'
  }));
});

// Global Error Handler
app.use(errorMiddleware);

// --- React Frontend Serve (Production) ---
const path = require('path');
const frontendDist = path.join(__dirname, '../../frontend/dist');

// Only serve static files in production (in development we use Vite's dev server)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(frontendDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
  
  // Catch-all route to serve React's index.html for client-side routing
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.sendFile(path.join(frontendDist, 'index.html'));
    } else {
      next();
    }
  });
}

module.exports = app;
