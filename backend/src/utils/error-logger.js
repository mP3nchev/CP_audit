const fs = require('fs');
const path = require('path');

const ERROR_LOG_PATH = path.join(__dirname, '../../logs/errors.log');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/error-screenshots');

// Ensure logs directory exists
function ensureLogDirectory() {
  const logsDir = path.dirname(ERROR_LOG_PATH);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

/**
 * Log error to file system
 * @param {Error} error - Error object
 * @param {Object} context - Additional context (req, audit_id, etc.)
 */
function logError(error, context = {}) {
  ensureLogDirectory();

  const logEntry = {
    timestamp: new Date().toISOString(),
    error: {
      message: error.message,
      code: error.code || 'UNKNOWN',
      name: error.name,
      stack: error.stack
    },
    context: {
      url: context.url || context.originalUrl,
      method: context.method,
      auditId: context.auditId,
      userId: context.userId,
      ip: context.ip
    }
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  fs.appendFileSync(ERROR_LOG_PATH, logLine, 'utf8');

  // Also log to console for debugging
  console.error('📝 Error logged to file:', ERROR_LOG_PATH);
}

/**
 * Save screenshot for debugging failed scans
 * @param {Buffer} screenshot - Screenshot buffer
 * @param {string} auditId - Audit ID
 * @param {string} reason - Failure reason
 */
async function saveErrorScreenshot(screenshot, auditId, reason = 'error') {
  ensureLogDirectory();

  const filename = `${auditId}_${reason}_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  try {
    fs.writeFileSync(filepath, screenshot);
    console.log(`📸 Error screenshot saved: ${filepath}`);
    return filepath;
  } catch (err) {
    console.error('Failed to save error screenshot:', err);
    return null;
  }
}

/**
 * Get recent errors from log file
 * @param {number} limit - Number of recent errors to retrieve
 */
function getRecentErrors(limit = 20) {
  ensureLogDirectory();

  if (!fs.existsSync(ERROR_LOG_PATH)) {
    return [];
  }

  const content = fs.readFileSync(ERROR_LOG_PATH, 'utf8');
  const lines = content.trim().split('\n').filter(line => line.length > 0);

  return lines
    .slice(-limit)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter(entry => entry !== null)
    .reverse();
}

/**
 * Clear error logs (for maintenance)
 */
function clearErrorLogs() {
  if (fs.existsSync(ERROR_LOG_PATH)) {
    fs.writeFileSync(ERROR_LOG_PATH, '', 'utf8');
    console.log('✅ Error logs cleared');
  }
}

module.exports = {
  logError,
  saveErrorScreenshot,
  getRecentErrors,
  clearErrorLogs
};
