const express = require('express');
const router = express.Router();
const { checkDatabaseHealth } = require('../database/db');
const { getRecentErrors } = require('../utils/error-logger');

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
router.get('/health/detailed', async (req, res) => {
  try {
    const dbHealthy = checkDatabaseHealth();

    // Check Claude API key validity
    const claudeApiStatus = checkClaudeApiKey();

    // Check Vercel Blob token
    const blobTokenStatus = checkVercelBlobToken();

    const allHealthy = dbHealthy && claudeApiStatus.valid && blobTokenStatus.valid;

    const health = {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: {
          status: dbHealthy ? 'healthy' : 'unhealthy',
          message: dbHealthy ? 'Database connection OK' : 'Database connection failed'
        },
        claudeApi: {
          status: claudeApiStatus.valid ? 'healthy' : 'unhealthy',
          message: claudeApiStatus.message,
          configured: claudeApiStatus.configured
        },
        vercelBlob: {
          status: blobTokenStatus.valid ? 'healthy' : 'unhealthy',
          message: blobTokenStatus.message,
          configured: blobTokenStatus.configured
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
          puppeteerHeadless: process.env.PUPPETEER_HEADLESS || 'true',
          nodeEnv: process.env.NODE_ENV || 'development'
        }
      }
    };

    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Helper function to check Claude API key
function checkClaudeApiKey() {
  const apiKey = process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    return {
      valid: false,
      configured: false,
      message: 'Claude API key not configured'
    };
  }

  // Basic validation - key should start with 'sk-ant-' and be at least 40 chars
  if (!apiKey.startsWith('sk-ant-') || apiKey.length < 40) {
    return {
      valid: false,
      configured: true,
      message: 'Claude API key format appears invalid'
    };
  }

  return {
    valid: true,
    configured: true,
    message: 'Claude API key configured and format valid'
  };
}

// Helper function to check Vercel Blob token
function checkVercelBlobToken() {
  const token = process.env.VERCEL_BLOB_TOKEN;

  if (!token) {
    return {
      valid: false,
      configured: false,
      message: 'Vercel Blob token not configured'
    };
  }

  // Basic validation - token should have some minimum length
  if (token.length < 20) {
    return {
      valid: false,
      configured: true,
      message: 'Vercel Blob token appears invalid (too short)'
    };
  }

  return {
    valid: true,
    configured: true,
    message: 'Vercel Blob token configured'
  };
}

/**
 * Get recent errors (for debugging)
 * GET /health/errors
 */
router.get('/health/errors', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const errors = getRecentErrors(limit);

    res.status(200).json({
      count: errors.length,
      errors: errors
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve error logs',
      message: error.message
    });
  }
});

module.exports = router;
