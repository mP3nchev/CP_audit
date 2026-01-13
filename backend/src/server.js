require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDatabase, closeDatabase } = require('./database/db');
const healthRoutes = require('./routes/health.routes');
const constants = require('./config/constants');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
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

// Routes
app.use('/', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'GDPR Privacy & Cookie Compliance Auditor API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      detailedHealth: '/health/detailed'
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
      'GET /health/detailed'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'E500'
  });
});

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
