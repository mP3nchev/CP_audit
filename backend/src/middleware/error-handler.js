const { logError } = require('../utils/error-logger');

/**
 * Global error handler middleware
 * Handles all errors and provides user-friendly messages
 */
function errorHandler(err, req, res, next) {
  // Log error to console
  console.error('❌ Error occurred:', {
    message: err.message,
    code: err.code || 'UNKNOWN',
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Log to file system
  logError(err, req);

  // Handle specific error types
  if (err.code) {
    // Known error codes from our application
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code,
      timestamp: new Date().toISOString()
    });
  }

  // Puppeteer/timeout errors
  if (err.message?.includes('timeout') || err.message?.includes('Navigation timeout')) {
    return res.status(503).json({
      error: 'Website took too long to load. Please try again or check if the site is accessible.',
      code: 'E001',
      userFriendly: true
    });
  }

  // URL errors
  if (err.message?.includes('ERR_NAME_NOT_RESOLVED') || err.message?.includes('ERR_CONNECTION_REFUSED')) {
    return res.status(400).json({
      error: 'Unable to access website. Please check the URL and try again.',
      code: 'E002',
      hint: 'Make sure the URL is correct and the website is accessible.'
    });
  }

  // Claude API errors
  if (err.message?.includes('429') || err.statusCode === 429) {
    return res.status(429).json({
      error: 'API rate limit reached. Please try again in a few minutes.',
      code: 'E102',
      retryAfter: 60
    });
  }

  if (err.message?.includes('API key')) {
    return res.status(500).json({
      error: 'Service configuration error. Please contact support.',
      code: 'E103'
    });
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File too large. Maximum size is 10MB.',
      code: 'E201'
    });
  }

  // Puppeteer/Scanner errors
  if (err.name === 'TimeoutError') {
    return res.status(503).json({
      error: 'Website took too long to load. Please try again or check if the website is accessible.',
      code: 'E001',
      userMessage: 'Site took too long to respond (timeout after 2 minutes)'
    });
  }

  // Claude API errors
  if (err.status === 429) {
    return res.status(429).json({
      error: 'API rate limit exceeded. Please try again in a few minutes.',
      code: 'E102',
      retryAfter: err.retryAfter || 60
    });
  }

  // File processing errors
  if (err.code === 'FILE_TOO_LARGE') {
    return res.status(400).json({
      error: 'File size exceeds 10MB limit',
      code: 'E201'
    });
  }

  // Default error response
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'An unexpected error occurred. Please try again later.',
    code: 'E500',
    requestId: req.id || 'unknown'
  });
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
