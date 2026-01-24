/**
 * Violation Debug Logger
 *
 * Purpose: Comprehensive logging for NOYB violations detection
 * Logs: Element selectors, CSS properties, computed styles, screenshots, errors
 * Output: JSON logs + screenshots saved to /logs/violations/
 */

const fs = require('fs').promises;
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs/violations');

// Ensure logs directory exists
async function ensureLogsDir() {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create logs directory:', error);
  }
}

/**
 * Initialize debug session
 * @param {string} auditId - Audit ID
 * @returns {string} Session ID
 */
async function initDebugSession(auditId) {
  await ensureLogsDir();

  const sessionId = `${auditId}_${Date.now()}`;
  const sessionDir = path.join(LOGS_DIR, sessionId);

  await fs.mkdir(sessionDir, { recursive: true });

  console.log(`📝 Debug session initialized: ${sessionId}`);

  return sessionId;
}

/**
 * Log violation check details
 * @param {string} sessionId - Debug session ID
 * @param {string} violationType - Violation type (type_a, type_b, etc.)
 * @param {Object} data - Log data
 */
async function logViolationCheck(sessionId, violationType, data) {
  const sessionDir = path.join(LOGS_DIR, sessionId);
  const logFile = path.join(sessionDir, `${violationType}.json`);

  const logEntry = {
    timestamp: new Date().toISOString(),
    violationType,
    ...data
  };

  try {
    await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2));
    console.log(`  📄 ${violationType} log saved`);
  } catch (error) {
    console.error(`  ❌ Failed to save ${violationType} log:`, error.message);
  }
}

/**
 * Save screenshot evidence
 * @param {string} sessionId - Debug session ID
 * @param {string} violationType - Violation type
 * @param {Buffer} screenshot - Screenshot buffer
 * @param {string} label - Screenshot label (e.g., "banner", "accept_button")
 */
async function saveScreenshot(sessionId, violationType, screenshot, label = 'screenshot') {
  const sessionDir = path.join(LOGS_DIR, sessionId);
  const filename = `${violationType}_${label}.png`;
  const filepath = path.join(sessionDir, filename);

  try {
    await fs.writeFile(filepath, screenshot);
    console.log(`  📸 Screenshot saved: ${filename}`);
    return filepath;
  } catch (error) {
    console.error(`  ❌ Failed to save screenshot:`, error.message);
    return null;
  }
}

/**
 * Log element details with computed styles
 * @param {Page} page - Puppeteer page
 * @param {ElementHandle} element - Element to log
 * @param {string} label - Element label
 * @returns {Promise<Object>} Element details
 */
async function logElementDetails(page, element, label) {
  if (!element) {
    return {
      label,
      found: false,
      message: 'Element not found'
    };
  }

  try {
    const details = await page.evaluate((el) => {
      const computedStyle = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return {
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        textContent: el.textContent?.substring(0, 100),
        attributes: Array.from(el.attributes).map(attr => ({
          name: attr.name,
          value: attr.value
        })),
        computedStyle: {
          display: computedStyle.display,
          visibility: computedStyle.visibility,
          opacity: computedStyle.opacity,
          fontSize: computedStyle.fontSize,
          fontWeight: computedStyle.fontWeight,
          color: computedStyle.color,
          backgroundColor: computedStyle.backgroundColor,
          borderColor: computedStyle.borderColor,
          width: computedStyle.width,
          height: computedStyle.height,
          padding: computedStyle.padding,
          margin: computedStyle.margin
        },
        boundingBox: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0
        },
        isVisible: computedStyle.display !== 'none' &&
                   computedStyle.visibility !== 'hidden' &&
                   parseFloat(computedStyle.opacity) > 0 &&
                   rect.width > 0 && rect.height > 0
      };
    }, element);

    return {
      label,
      found: true,
      ...details
    };
  } catch (error) {
    return {
      label,
      found: true,
      error: error.message
    };
  }
}

/**
 * Generate summary report for debug session
 * @param {string} sessionId - Debug session ID
 * @param {Object} summary - Summary data
 */
async function saveSummary(sessionId, summary) {
  const sessionDir = path.join(LOGS_DIR, sessionId);
  const summaryFile = path.join(sessionDir, '_summary.json');

  const summaryData = {
    sessionId,
    timestamp: new Date().toISOString(),
    ...summary
  };

  try {
    await fs.writeFile(summaryFile, JSON.stringify(summaryData, null, 2));
    console.log(`📋 Debug summary saved: ${summaryFile}`);
  } catch (error) {
    console.error('Failed to save summary:', error.message);
  }
}

/**
 * Log error with context
 * @param {string} sessionId - Debug session ID
 * @param {string} violationType - Violation type
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
async function logError(sessionId, violationType, error, context = {}) {
  const sessionDir = path.join(LOGS_DIR, sessionId);
  const errorFile = path.join(sessionDir, `${violationType}_error.json`);

  const errorData = {
    timestamp: new Date().toISOString(),
    violationType,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context
  };

  try {
    await fs.writeFile(errorFile, JSON.stringify(errorData, null, 2));
    console.error(`  ❌ Error logged: ${violationType}`);
  } catch (writeError) {
    console.error('Failed to log error:', writeError.message);
  }
}

module.exports = {
  initDebugSession,
  logViolationCheck,
  saveScreenshot,
  logElementDetails,
  saveSummary,
  logError,
  LOGS_DIR
};
