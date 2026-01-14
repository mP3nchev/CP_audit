// Error codes mapping
const ERROR_CODES = {
  // Scanning errors
  SCAN_TIMEOUT: { code: 'E001', status: 503, message: 'Website took too long to load. Try again or check if the site is accessible.' },
  SCAN_FAILED: { code: 'E002', status: 503, message: 'Unable to access website. Please check the URL and try again.' },
  INVALID_URL: { code: 'E003', status: 400, message: 'Invalid or malformed URL. Please provide a valid website address.' },

  // API errors
  CLAUDE_TIMEOUT: { code: 'E101', status: 504, message: 'AI analysis request timed out. Please try again.' },
  CLAUDE_RATE_LIMIT: { code: 'E102', status: 429, message: 'AI service rate limit reached. Please wait a moment and try again.' },
  INVALID_API_KEY: { code: 'E103', status: 500, message: 'API configuration error. Please contact support.' },

  // File errors
  FILE_TOO_LARGE: { code: 'E201', status: 400, message: 'File exceeds 10MB limit. Please upload a smaller file.' },
  INVALID_FILE_TYPE: { code: 'E202', status: 400, message: 'Unsupported file format. Please upload PDF, DOCX, or HTML files.' },
  TEXT_EXTRACTION_FAILED: { code: 'E203', status: 400, message: 'Could not extract text from file. Please check file format and try again.' },

  // Database errors
  DB_CONNECTION_FAILED: { code: 'E301', status: 500, message: 'Database connection error. Please try again later.' },
  DB_WRITE_FAILED: { code: 'E302', status: 500, message: 'Failed to save audit results. Please try again.' },

  // Storage errors
  BLOB_UPLOAD_FAILED: { code: 'E401', status: 500, message: 'Failed to upload screenshots. The audit will continue without images.' },

  // Validation errors
  MISSING_CRITERIA: { code: 'E501', status: 500, message: 'AI response incomplete. Please try running the audit again.' }
};

// Custom error class
class AppError extends Error {
  constructor(code, customMessage = null) {
    const errorInfo = ERROR_CODES[code] || {
      code: 'E500',
      status: 500,
      message: 'An unexpected error occurred'
    };

    super(customMessage || errorInfo.message);
    this.code = errorInfo.code;
    this.status = errorInfo.status;
    this.isOperational = true;
  }
}

// Import logger
const { logError } = require('../utils/error-logger');

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  // Log error to file and console
  logError(err, req);

  // Handle AppError instances
  if (err.isOperational) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      timestamp: new Date().toISOString()
    });
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed: ' + err.message,
      code: 'E400',
      timestamp: new Date().toISOString()
    });
  }

  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service temporarily unavailable. Please try again later.',
      code: 'E503',
      timestamp: new Date().toISOString()
    });
  }

  // Log unexpected errors
  console.error('❌ Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Send generic error response
  res.status(500).json({
    error: 'An unexpected error occurred. Our team has been notified.',
    code: 'E500',
    timestamp: new Date().toISOString()
  });
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  asyncHandler,
  AppError,
  ERROR_CODES
};
