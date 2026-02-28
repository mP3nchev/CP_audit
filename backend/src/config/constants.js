/**
 * Application constants and configuration
 */

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || './audits.db',

  // Claude API
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
  DAILY_BUDGET_USD: parseFloat(process.env.DAILY_BUDGET_USD) || 10.0,

  // Vercel Blob
  VERCEL_BLOB_TOKEN: process.env.VERCEL_BLOB_TOKEN,

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 3600000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,

  // Puppeteer
  PUPPETEER_TIMEOUT_MS: parseInt(process.env.PUPPETEER_TIMEOUT_MS) || 120000,
  PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS === 'true',

  // React Report Rendering
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || 'http://localhost:3000',
  REPORT_RENDER_TIMEOUT_MS: parseInt(process.env.REPORT_RENDER_TIMEOUT_MS) || 60000,
  PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,

  // Consent Simulation
  CONSENT_MODE: process.env.CONSENT_MODE || 'assisted', // Only 'assisted' supported in v1
  IS_RAILWAY: !!process.env.RAILWAY_ENVIRONMENT,

  // Screenshots (feature flag)
  ENABLE_SCREENSHOTS: process.env.ENABLE_SCREENSHOTS === 'true',
  SCREENSHOT_TIMEOUT_MS: parseInt(process.env.SCREENSHOT_TIMEOUT_MS) || 20000,

  // File Upload
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['.pdf', '.docx', '.html', '.htm'],

  // Audit Status
  AUDIT_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed'
  },

  // Error Codes
  ERROR_CODES: {
    // Scanning errors
    SCAN_TIMEOUT: { code: 'E001', message: 'Website took too long to load' },
    SCAN_FAILED: { code: 'E002', message: 'Unable to access website' },
    INVALID_URL: { code: 'E003', message: 'Invalid or malformed URL' },

    // API errors
    CLAUDE_TIMEOUT: { code: 'E101', message: 'Claude API request timed out' },
    CLAUDE_RATE_LIMIT: { code: 'E102', message: 'Claude API rate limit reached' },
    INVALID_API_KEY: { code: 'E103', message: 'Invalid Claude API key' },

    // File errors
    FILE_TOO_LARGE: { code: 'E201', message: 'File exceeds 10MB limit' },
    INVALID_FILE_TYPE: { code: 'E202', message: 'Unsupported file format' },
    TEXT_EXTRACTION_FAILED: { code: 'E203', message: 'Could not extract text from file' },

    // Database errors
    DB_CONNECTION_FAILED: { code: 'E301', message: 'Database connection failed' },
    DB_WRITE_FAILED: { code: 'E302', message: 'Failed to save audit results' },

    // Storage errors
    BLOB_UPLOAD_FAILED: { code: 'E401', message: 'Failed to upload screenshot' },

    // Validation errors
    MISSING_CRITERIA: { code: 'E501', message: 'Claude response missing required criteria' }
  }
};
