const express = require('express');
const router = express.Router();
const { checkDatabaseHealth } = require('../database/db');

/**
 * Health check endpoint
 * GET /health
 */
router.get('/health', (req, res) => {
  const startTime = Date.now();

  try {
    // Check database connection
    const dbHealthy = checkDatabaseHealth();

    const response = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealthy ? 'connected' : 'disconnected',
      environment: process.env.NODE_ENV || 'development',
      responseTime: Date.now() - startTime
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Service unavailable',
      error: error.message
    });
  }
});

/**
 * Detailed health check endpoint
 * GET /health/detailed
 */
router.get('/health/detailed', (req, res) => {
  try {
    const dbHealthy = checkDatabaseHealth();

    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: {
          status: dbHealthy ? 'healthy' : 'unhealthy',
          message: dbHealthy ? 'Database connection OK' : 'Database connection failed'
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
          }
        },
        configuration: {
          claudeApiKey: process.env.CLAUDE_API_KEY ? 'configured' : 'missing',
          vercelBlobToken: process.env.VERCEL_BLOB_TOKEN ? 'configured' : 'missing',
          puppeteerHeadless: process.env.PUPPETEER_HEADLESS || 'true'
        }
      }
    };

    res.status(200).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

module.exports = router;
