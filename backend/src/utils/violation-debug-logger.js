/**
 * Violation Debug Logger
 *
 * Purpose: Comprehensive logging for NOYB violations detection
 * Logs: Element selectors, CSS properties, computed styles, screenshots, errors
 * Output: Vercel Blob storage under logs/<auditId>/
 *
 * ENV: DEBUG_VIOLATIONS=true — must be set or all functions are no-ops
 */

// const fs = require('fs').promises;  // migrated to Vercel Blob — kept for reference
// const path = require('path');       // migrated to Vercel Blob — kept for reference

const { uploadBlob } = require('../integrations/blob-storage');
const { createLogger } = require('./logger');

const logger = createLogger('violation-debug-logger');

// const LOGS_DIR = path.join(__dirname, '../../logs/violations');  // Railway ephemeral — no longer used

// In-memory session buffer — replaces local filesystem writes
const sessionStore = new Map();

// // Ensure logs directory exists — no longer needed (Blob storage)
// async function ensureLogsDir() {
//   try {
//     await fs.mkdir(LOGS_DIR, { recursive: true });
//   } catch (error) {
//     console.error('Failed to create logs directory:', error);
//   }
// }

/**
 * Initialize debug session
 * @param {string} auditId - Audit ID
 * @returns {string} Session ID
 */
async function initDebugSession(auditId) {
  // // await ensureLogsDir();  // no longer needed
  // // const sessionDir = path.join(LOGS_DIR, sessionId);  // no longer needed
  // // await fs.mkdir(sessionDir, { recursive: true });  // no longer needed

  const sessionId = `${auditId}_${Date.now()}`;

  sessionStore.set(sessionId, {
    auditId,
    startedAt: new Date().toISOString(),
    checks: {},
    errors: {}
  });

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
  // // const sessionDir = path.join(LOGS_DIR, sessionId);  // no longer needed
  // // const logFile = path.join(sessionDir, `${violationType}.json`);  // no longer needed

  const logEntry = {
    timestamp: new Date().toISOString(),
    violationType,
    ...data
  };

  // // try {
  // //   await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2));  // migrated to in-memory
  // //   console.log(`  📄 ${violationType} log saved`);
  // // } catch (error) {
  // //   console.error(`  ❌ Failed to save ${violationType} log:`, error.message);
  // // }

  const session = sessionStore.get(sessionId);
  if (session) {
    session.checks[violationType] = logEntry;
  }
  console.log(`  📄 ${violationType} log buffered`);
}

/**
 * Save screenshot evidence — uploads immediately to Vercel Blob, no in-memory buffering
 * @param {string} sessionId - Debug session ID
 * @param {string} violationType - Violation type
 * @param {Buffer} screenshot - Screenshot buffer
 * @param {string} label - Screenshot label (e.g., "banner", "accept_button")
 * @returns {Promise<string|null>} Blob URL or null on failure
 */
async function saveScreenshot(sessionId, violationType, screenshot, label = 'screenshot') {
  // // const sessionDir = path.join(LOGS_DIR, sessionId);  // no longer needed
  // // const filename = `${violationType}_${label}.png`;  // no longer needed
  // // const filepath = path.join(sessionDir, filename);  // no longer needed
  // // try {
  // //   await fs.writeFile(filepath, screenshot);  // migrated to Blob
  // //   console.log(`  📸 Screenshot saved: ${filename}`);
  // //   return filepath;
  // // } catch (error) {
  // //   console.error(`  ❌ Failed to save screenshot:`, error.message);
  // //   return null;
  // // }

  const session = sessionStore.get(sessionId);
  if (!session) {
    logger.warn('screenshot-no-session', { sessionId, violationType });
    return null;
  }

  const { auditId } = session;
  const timestamp = Date.now();
  const blobPath = `logs/${auditId}/screenshots/${violationType}_${label}_${timestamp}.png`;

  try {
    const url = await Promise.race([
      uploadBlob(screenshot, blobPath),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Blob upload timeout after 10s')), 10000)
      )
    ]);
    console.log(`  📸 Screenshot uploaded: ${blobPath}`);
    return url;
  } catch (error) {
    logger.warn('screenshot-upload-failed', { auditId, blobPath, error: error.message });
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
 * Upload serialized session data to Vercel Blob
 * @param {string} auditId - Audit ID
 * @param {string} sessionId - Session ID (for logging)
 * @param {Object} summaryData - Assembled summary object to serialize
 */
async function uploadSessionToBlob(auditId, sessionId, summaryData) {
  const timestamp = Date.now();
  const blobPath = `logs/${auditId}/${timestamp}_summary.json`;
  const buffer = Buffer.from(JSON.stringify(summaryData, null, 2));

  try {
    await Promise.race([
      uploadBlob(buffer, blobPath),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Blob upload timeout after 10s')), 10000)
      )
    ]);
    logger.info('debug-session-uploaded', { auditId, sessionId, blobPath });
  } catch (error) {
    // Blob failure must NOT abort the audit — log and continue
    logger.warn('debug-session-upload-failed', { auditId, sessionId, error: error.message });
  }
}

/**
 * Generate summary report for debug session and upload to Vercel Blob
 * @param {string} sessionId - Debug session ID
 * @param {Object} summary - Summary data
 */
async function saveSummary(sessionId, summary) {
  // // const sessionDir = path.join(LOGS_DIR, sessionId);  // no longer needed
  // // const summaryFile = path.join(sessionDir, '_summary.json');  // no longer needed

  const session = sessionStore.get(sessionId);
  const { auditId, startedAt, checks, errors } = session || {};

  const summaryData = {
    sessionId,
    auditId,
    startedAt,
    timestamp: new Date().toISOString(),
    checks,
    errors,
    ...summary
  };

  // // try {
  // //   await fs.writeFile(summaryFile, JSON.stringify(summaryData, null, 2));  // migrated to Blob
  // //   console.log(`📋 Debug summary saved: ${summaryFile}`);
  // // } catch (error) {
  // //   console.error('Failed to save summary:', error.message);
  // // }

  await uploadSessionToBlob(auditId, sessionId, summaryData);

  // Release session from memory after upload attempt
  sessionStore.delete(sessionId);
}

/**
 * Log error with context
 * @param {string} sessionId - Debug session ID
 * @param {string} violationType - Violation type
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
async function logError(sessionId, violationType, error, context = {}) {
  // // const sessionDir = path.join(LOGS_DIR, sessionId);  // no longer needed
  // // const errorFile = path.join(sessionDir, `${violationType}_error.json`);  // no longer needed

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

  // // try {
  // //   await fs.writeFile(errorFile, JSON.stringify(errorData, null, 2));  // migrated to in-memory
  // //   console.error(`  ❌ Error logged: ${violationType}`);
  // // } catch (writeError) {
  // //   console.error('Failed to log error:', writeError.message);
  // // }

  const session = sessionStore.get(sessionId);
  if (session) {
    session.errors[violationType] = errorData;
  }
  console.error(`  ❌ Error logged: ${violationType}`);
}

module.exports = {
  initDebugSession,
  logViolationCheck,
  saveScreenshot,
  logElementDetails,
  saveSummary,
  logError,
  uploadSessionToBlob
  // LOGS_DIR  // removed — Railway ephemeral filesystem, no longer used
};
