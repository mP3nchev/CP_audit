require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDatabase, getDatabase, closeDatabase } = require('./database/db');
const { migrate: migrateScoring } = require('./database/migrate-add-scoring');
const { migrate: migrateMonitoring } = require('./database/migrate-add-monitoring');
const { migrate: migrateBannerDetection } = require('./database/migrate-add-banner-detection');
const healthRoutes = require('./routes/health.routes');
const auditRoutes = require('./routes/audit.routes');
const constants = require('./config/constants');
const { errorHandler } = require('./config/error-codes');
const { authMiddleware } = require('./middleware/auth');
const { requestIdMiddleware } = require('./middleware/requestId');

// Environment variable validation
const requiredEnvVars = ['CLAUDE_API_KEY', 'VERCEL_BLOB_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\nPlease check your .env file and ensure all required variables are set.');
  process.exit(1);
}

console.log('✅ Environment variables validated');

const app = express();

// Strict CORS — only allow configured origin(s)
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://cp-audit-dg6j.vercel.app')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server (Railway internal, health checks, curl)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(), level: 'warn', event: 'cors_blocked', origin
    }) + '\n');
    // Return false (not an Error) — avoids propagating to Express error handler
    // Browser receives 204 without CORS headers and treats it as a CORS rejection
    callback(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  credentials: false,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request ID middleware (for log correlation)
app.use(requestIdMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} [${req.requestId}]`);
  next();
});

// Initialize database
try {
  initDatabase();
  console.log('✅ Database initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize database:', error);
  process.exit(1);
}

// Run database migrations using the existing connection
try {
  const db = getDatabase();
  migrateScoring(db);
  migrateMonitoring(db);
  migrateBannerDetection(db);
} catch (error) {
  console.error('⚠️  Migration warning:', error.message);
  console.log('   Continuing with server startup...');
}

// Routes
app.use('/', healthRoutes);

// Public endpoints (no auth required)
const publicPaths = ['/api/audit/:id/share', '/api/audit/:id/report-v2', '/api/audit/:id/report'];

// Auth middleware with public path exemption
app.use('/api', (req, res, next) => {
  // Check if path matches any public endpoint pattern
  const isPublic = publicPaths.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/:[^\s/]+/g, '[^/]+') + '$');
    return regex.test(req.path);
  });

  if (isPublic) {
    console.log(`📖 Public endpoint accessed: ${req.path}`);
    return next(); // Skip auth for public endpoints
  }

  // Apply auth for all other /api/* endpoints
  return authMiddleware(req, res, next);
});

app.use('/', auditRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'GDPR Privacy & Cookie Compliance Auditor API',
    version: '1.0.0',
    status: 'running',
    phase: 'Phase 4 - HTML Report Generation Active',
    features: {
      phase1: 'Puppeteer Scanner (cookies, tracking, screenshots)',
      phase2: 'Privacy Policy Analysis (37 GDPR criteria)',
      phase3: 'Risk Assessment, noyb Checklist, Consent Mode V2, Cookie Comparison, Solutions',
      phase4: 'HTML Report Generation with Chart.js Visualizations & Shareable Links'
    },
    endpoints: {
      health: '/health',
      detailedHealth: '/health/detailed',
      startAudit: 'POST /api/audit/start',
      auditStatus: 'GET /api/audit/:id/status',
      auditResults: 'GET /api/audit/:id/results',
      listAudits: 'GET /api/audits',
      uploadPolicy: 'POST /api/audit/:id/privacy-policy',
      getPolicyAnalysis: 'GET /api/audit/:id/policy-analysis',
      viewReport: 'GET /api/audit/:id/report',
      shareReport: 'GET /api/audit/:id/share'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /health/detailed',
      'POST /api/audit/start',
      'GET /api/audit/:id/status',
      'GET /api/audit/:id/results',
      'GET /api/audits',
      'POST /api/audit/:id/privacy-policy',
      'GET /api/audit/:id/policy-analysis',
      'GET /api/audit/:id/report',
      'GET /api/audit/:id/share'
    ]
  });
});

// Global error handling middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = constants.PORT;
const server = app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ===================================');
  console.log('🚀 GDPR Auditor Backend Server');
  console.log('🚀 ===================================');
  console.log(`🚀 Environment: ${constants.NODE_ENV}`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🚀 Health check: http://localhost:${PORT}/health`);
  console.log('🚀 ===================================');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    closeDatabase();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    closeDatabase();
    process.exit(0);
  });
});

module.exports = app;
